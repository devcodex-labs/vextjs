import { fork, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectAffinitySlot } from "../../../src/lib/cluster/affinity-router.js";

const processes: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of processes.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.send({ type: "shutdown" });
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function waitMessage(child: ChildProcess, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for ${type}`));
    }, 10000);
    const message = (value: any) => {
      if (value.type === type) {
        cleanup();
        resolve(value);
      } else if (value.type === "error") {
        cleanup();
        reject(new Error(value.error));
      }
    };
    const exit = () => {
      cleanup();
      reject(new Error(`Master exited before ${type}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", message);
      child.off("exit", exit);
    };
    child.on("message", message);
    child.once("exit", exit);
  });
}

async function start(
  adapter = "native",
  factory = false,
  extra: Record<string, string> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "vext-affinity-"));
  directories.push(directory);
  const pidFile = join(directory, "master.pid");
  const child = fork(
    join(process.cwd(), "test/integration/cluster/affinity-fixture.mjs"),
    [],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [],
      env: {
        ...process.env,
        AFFINITY_ADAPTER: adapter,
        AFFINITY_FACTORY: factory ? "1" : "0",
        AFFINITY_PID_FILE: pidFile,
        ...extra,
      },
    },
  );
  processes.push(child);
  let logs = "";
  child.stdout?.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    logs += chunk;
  });
  try {
    return { child, pidFile, ...(await waitMessage(child, "listening")) };
  } catch (error) {
    throw new Error(`${error}\n${logs}`);
  }
}

function request(
  port: number,
  address = "127.0.0.1",
  path = "/",
  agent: http.Agent | false = false,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path, localAddress: address, agent },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(body));
          }
        });
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error("HTTP request timeout")));
    req.on("error", reject);
  });
}

describe("real IP sticky Cluster", () => {
  for (const adapter of ["native", "hono", "fastify", "express", "koa"]) {
    for (const factory of [false, true]) {
      it(`${adapter} ${factory ? "factory" : "string"}: independent connections keep affinity and source IP`, async () => {
        const { endpoint } = await start(adapter, factory);
        const replies = await Promise.all(
          Array.from({ length: 24 }, () => request(endpoint.port)),
        );
        expect(new Set(replies.map((reply) => reply.pid)).size).toBe(1);
        expect(replies.every((reply) => reply.remote === "127.0.0.1")).toBe(
          true,
        );
        const agent = new http.Agent({ keepAlive: true });
        try {
          expect(
            (await request(endpoint.port, "127.0.0.1", "/", agent)).pid,
          ).toBe(replies[0].pid);
          expect(
            (await request(endpoint.port, "127.0.0.1", "/", agent)).pid,
          ).toBe(replies[0].pid);
        } finally {
          agent.destroy();
        }
      });
    }
  }

  it("replaces generations without adding routable slots and cleans PID on shutdown", async () => {
    const { child, endpoint, workers, pidFile } = await start();
    const before = await request(endpoint.port);
    const ready = waitMessage(child, "reloaded");
    child.send({ type: "reload" });
    await ready;
    const after = await request(endpoint.port);
    expect(after.pid).not.toBe(before.pid);
    const snapshot = waitMessage(child, "snapshot");
    child.send({ type: "snapshot" });
    const result = await snapshot;
    expect(result.workers.map((worker: any) => worker.slotId).sort()).toEqual(
      workers.map((worker: any) => worker.slotId).sort(),
    );
    expect(result.workers).toHaveLength(2);
    expect(result.connections.pending).toBe(0);
    const exit = once(child, "exit");
    child.send({ type: "shutdown" });
    expect((await exit)[0]).toBe(0);
    expect(existsSync(pidFile)).toBe(false);
  });

  it("keeps old Workers when candidates fail", async () => {
    const { child, endpoint } = await start("native", false, {
      AFFINITY_FAIL_CANDIDATE: "1",
    });
    const before = await request(endpoint.port);
    const reloaded = waitMessage(child, "reloaded");
    child.send({ type: "reload" });
    await reloaded;
    expect((await request(endpoint.port)).pid).toBe(before.pid);
  });

  it("shuts down cleanly when a live Worker has already disconnected IPC", async () => {
    const { child, workers, pidFile } = await start("native", false, {
      AFFINITY_SLOW_CLOSE: "1",
    });
    const exit = once(child, "exit");
    child.send({
      type: "disconnect-and-stop",
      id: workers.find((worker: any) => worker.slotId === 0).id,
    });
    expect((await exit)[0]).toBe(0);
    expect(existsSync(pidFile)).toBe(false);
  });

  it("does not add a new slot when another Worker crashes during rolling drain", async () => {
    const { child, workers } = await start("native", false, {
      AFFINITY_SLOW_CLOSE: "1",
    });
    const firstCandidate = waitMessage(child, "worker-ready");
    const reloaded = waitMessage(child, "reloaded");
    child.send({ type: "reload" });
    await firstCandidate;
    const recovered = waitMessage(child, "worker-ready");
    child.send({
      type: "crash",
      id: workers.find((worker: any) => worker.slotId === 1).id,
    });
    await recovered;
    await reloaded;
    const snapshot = waitMessage(child, "snapshot");
    child.send({ type: "snapshot" });
    const result = await snapshot;
    expect(result.workers).toHaveLength(2);
    expect(result.workers.map((worker: any) => worker.slotId).sort()).toEqual([
      0, 1,
    ]);
    expect(
      result.workers.every((worker: any) => worker.state === "ready"),
    ).toBe(true);
  });

  it("recovers the same slot after a real Worker crash", async () => {
    const { child, endpoint, workers } = await start();
    const before = await request(endpoint.port);
    const slot = selectAffinitySlot(
      "127.0.0.1",
      workers.map((worker: any) => worker.slotId),
    );
    const victim = workers.find((worker: any) => worker.slotId === slot);
    const ready = waitMessage(child, "worker-ready");
    child.send({ type: "crash", id: victim.id });
    await ready;
    const after = await request(endpoint.port);
    expect(after.pid).not.toBe(before.pid);
    const snapshot = waitMessage(child, "snapshot");
    child.send({ type: "snapshot" });
    expect(
      (await snapshot).workers.some(
        (worker: any) =>
          worker.slotId === slot && worker.generation === after.generation,
      ),
    ).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "distributes actual source IPs and only remaps the unavailable slot",
    async () => {
      const { child, endpoint, workers } = await start("native", false, {
        AFFINITY_AUTO_RESTART: "0",
      });
      const addresses = Array.from(
        { length: 12 },
        (_, i) => `127.0.0.${i + 1}`,
      );
      const before = await Promise.all(
        addresses.map((ip) => request(endpoint.port, ip)),
      );
      expect(new Set(before.map((reply) => reply.pid)).size).toBe(2);
      for (let i = 0; i < addresses.length; i++) {
        const slot = selectAffinitySlot(addresses[i]!, [0, 1]);
        expect(before[i].generation).toBe(
          workers.find((worker: any) => worker.slotId === slot).generation,
        );
      }
      const victim = workers[0];
      const exited = waitMessage(child, "worker-exit");
      child.send({ type: "crash", id: victim.id });
      await exited;
      const after = await Promise.all(
        addresses.map((ip) => request(endpoint.port, ip)),
      );
      expect(new Set(after.map((reply) => reply.pid)).size).toBe(1);
      for (let i = 0; i < addresses.length; i++) {
        if (before[i].generation !== victim.generation)
          expect(after[i].pid).toBe(before[i].pid);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "bounds stalled handoffs and recovers an unresponsive Worker",
    async () => {
      const { child, endpoint, workers } = await start();
      const slot = selectAffinitySlot("127.0.0.1", [0, 1]);
      const victim = workers.find((worker: any) => worker.slotId === slot);
      const initial = await request(endpoint.port);
      process.kill(initial.pid, "SIGSTOP");
      const sockets = Array.from({ length: 120 }, () =>
        net.connect(endpoint.port, "127.0.0.1"),
      );
      for (const socket of sockets) socket.on("error", () => {});
      try {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const snapshot = waitMessage(child, "snapshot");
        child.send({ type: "snapshot" });
        const status = await snapshot;
        expect(status.connections.pending).toBeGreaterThan(0);
        expect(status.connections.pending).toBeLessThanOrEqual(64);
        expect(status.connections.rejected).toBeGreaterThan(0);
        const recovered = await waitMessage(child, "worker-ready");
        expect(recovered.data.workerId).not.toBe(victim.id);
        expect((await request(endpoint.port)).pid).not.toBe(initial.pid);
      } finally {
        for (const socket of sockets) socket.destroy();
        try {
          process.kill(initial.pid, "SIGCONT");
        } catch {
          /* already killed */
        }
      }
    },
  );

  it("closes partial-header connections within the shutdown budget", async () => {
    const { child, endpoint } = await start("fastify");
    const socket = net.connect(endpoint.port, "127.0.0.1");
    await once(socket, "connect");
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
    socket.on("error", () => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Forced teardown can produce ECONNRESET on Windows; the contract is that
    // the connection closes and Master finishes normally, rather than a FIN.
    const closed = new Promise<void>((resolve) =>
        socket.once("close", () => resolve()),
      ),
      exit = once(child, "exit");
    child.send({ type: "shutdown" });
    await closed;
    expect((await exit)[0]).toBe(0);
  });

  for (const adapter of ["native", "fastify"]) {
    it(`${adapter}: graceful Master shutdown waits for an in-flight response`, async () => {
      const { child, endpoint } = await start(adapter);
      const inFlight = waitMessage(child, "in-flight");
      const response = request(endpoint.port, "127.0.0.1", "/?delay=120");
      await inFlight;
      const exit = once(child, "exit");
      child.send({ type: "shutdown" });
      expect((await response).pid).toBeGreaterThan(0);
      expect((await exit)[0]).toBe(0);
    });
  }
});
