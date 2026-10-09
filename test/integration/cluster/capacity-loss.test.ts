import { it, expect } from "vitest";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readdir,
  readFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";

const repository = path.resolve(".");
async function fixture(autoRestart: boolean, workers = 1, sticky = "none") {
  const root = await mkdtemp(path.join(os.tmpdir(), "vext-capacity-loss-"));
  await mkdir(path.join(root, "src/config"), { recursive: true });
  await mkdir(path.join(root, "src/plugins"));
  await mkdir(path.join(root, "node_modules"));
  await symlink(
    repository,
    path.join(root, "node_modules/vextjs"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(
    path.join(root, "package.json"),
    '{"name":"capacity-loss-consumer","type":"module","private":true,"dependencies":{"vextjs":"2.0.0"}}',
  );
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const config = {
    port,
    host: "127.0.0.1",
    adapter: "native",
    frontend: false,
    logger: { level: "silent" },
    openapi: { enabled: false },
    cluster: {
      enabled: true,
      workers,
      autoRestart,
      sticky,
      maxRestarts: 1,
      restartWindow: 5000,
      restartBaseDelay: 30,
      restartMaxDelay: 30,
      pidFile: path.join(root, "master.pid"),
      healthCheck: { enabled: false },
      reload: { readyTimeout: 5000, shutdownTimeout: 1000 },
    },
  };
  await writeFile(
    path.join(root, "src/config/default.mjs"),
    `export default ${JSON.stringify(config)};`,
  );
  await writeFile(
    path.join(root, "src/plugins/crash.mjs"),
    `export default { name: "crash-probe", setup(app) { app.onReady(() => { if (${workers} === 1 || process.env.VEXT_WORKER_ID === "1") setTimeout(() => process.exit(17), 500); }); } };`,
  );
  return root;
}
function run(
  root: string,
  host: "ipc" | "direct" | "cli",
  parentReadyLog = false,
) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    VEXT_MODE: "start",
    VEXT_CLUSTER: "1",
    VEXT_ROOT: root,
    VEXT_BUILT: "",
    VEXT_CONFIG: "production",
    VEXT_START_PARENT_READY_LOG: parentReadyLog ? "1" : "",
  };
  const entry = path.join(repository, "dist/lib/bootstrap.js");
  const child =
    host === "ipc"
      ? fork(entry, [], {
          cwd: root,
          env,
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        })
      : spawn(
          process.execPath,
          host === "cli"
            ? [path.join(repository, "dist/cli/index.js"), "start"]
            : [entry],
          { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
        );
  let output = "";
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  return { child, output: () => output };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 3000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}

it.each([
  ["ipc", false],
  ["direct", false],
  ["cli", false],
  ["ipc", true],
  ["direct", true],
] as const)(
  "exits failed capacity loss in a %s host (autoRestart=%s)",
  async (host, autoRestart) => {
    const root = await fixture(autoRestart);
    const proc = run(root, host);
    const watchdog = setTimeout(() => proc.child.kill("SIGTERM"), 15000);
    try {
      const [code, signal] = await once(proc.child, "exit");
      expect(signal, proc.output()).toBeNull();
      expect(code, proc.output()).toBe(1);
      expect(proc.output()).toContain("no workers and no pending recovery");
      if (autoRestart) expect(proc.output()).toContain("restart rate exceeded");
      expect(existsSync(path.join(root, "master.pid"))).toBe(false);
      const folder = path.join(root, ".vext/runtime/snapshots");
      const snapshots = (await readdir(folder)).filter((name) =>
        name.endsWith(".json"),
      );
      const states = await Promise.all(
        snapshots.map(async (name) =>
          JSON.parse(await readFile(path.join(folder, name), "utf8")),
        ),
      );
      expect(
        states.some(
          (snapshot) =>
            snapshot.summary.state === "failed" &&
            snapshot.events.some(
              (event: { type: string }) => event.type === "fatal-capacity-loss",
            ),
        ),
      ).toBe(true);
    } finally {
      clearTimeout(watchdog);
      await stop(proc.child);
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("does not announce readiness after terminal capacity loss during startup", async () => {
  const root = await fixture(false, 2);
  await writeFile(
    path.join(root, "src/plugins/crash.mjs"),
    `export default { name: "startup-loss", async setup(app) {
      if (process.env.VEXT_WORKER_ID === "2") await new Promise(() => setTimeout(() => process.exit(18), 1000));
      app.onReady(() => setTimeout(() => process.exit(17), 100));
    } };`,
  );
  const proc = run(root, "ipc", true);
  const messages: Array<{ type?: string }> = [];
  proc.child.on("message", (message) =>
    messages.push(message as { type?: string }),
  );
  const watchdog = setTimeout(() => proc.child.kill("SIGTERM"), 15000);
  try {
    const [code, signal] = await once(proc.child, "exit");
    expect(signal, proc.output()).toBeNull();
    expect(code, proc.output()).toBe(1);
    expect(messages.some((message) => message.type === "ready")).toBe(false);
    expect(existsSync(path.join(root, "master.pid"))).toBe(false);
    const folder = path.join(root, ".vext/runtime/snapshots");
    const states = await Promise.all(
      (await readdir(folder))
        .filter((name) => name.endsWith(".json"))
        .map(async (name) =>
          JSON.parse(await readFile(path.join(folder, name), "utf8")),
        ),
    );
    expect(states.some((snapshot) => snapshot.summary.state === "failed")).toBe(
      true,
    );
  } finally {
    clearTimeout(watchdog);
    await stop(proc.child);
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps remaining workers alive and diagnoses sticky=ip before a normal shutdown", async () => {
  const root = await fixture(false, 2, "ip");
  const proc = run(root, "ipc");
  try {
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 12000;
      const poll = setInterval(() => {
        if (proc.output().includes("exited: code 17")) {
          clearInterval(poll);
          resolve();
        } else if (Date.now() > deadline || proc.child.exitCode !== null) {
          clearInterval(poll);
          reject(new Error(proc.output()));
        }
      }, 20);
    });
    expect(proc.child.exitCode).toBeNull();
    expect(proc.output()).toContain("does not provide IP affinity");
    expect(proc.output()).not.toContain("fatal capacity loss");
    const exit = once(proc.child, "exit");
    proc.child.send!({ type: "shutdown" });
    expect((await exit)[0], proc.output()).toBe(0);
    expect(existsSync(path.join(root, "master.pid"))).toBe(false);
  } finally {
    await stop(proc.child);
    await rm(root, { recursive: true, force: true });
  }
});
