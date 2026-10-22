import cluster from "node:cluster";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { JobsArbiter } from "../../dist/lib/cluster/jobs-arbiter.js";
import { JobsWorkerChannel } from "../../dist/lib/jobs/cluster-worker.js";
import { createJobsManifest } from "../../dist/lib/jobs/cluster-protocol.js";
import { defineJob } from "../../dist/lib/jobs/define-job.js";
import { nextJobTime } from "../../dist/lib/jobs/schedule.js";

const scenario = process.argv[2];
const controlled = scenario === "dst" || scenario === "long-pause";
let wall = Date.parse(
  scenario === "dst" ? "2026-11-01T04:00:00Z" : "2026-01-01T00:00:00Z",
);
if (controlled) {
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [wall]));
    }
    static now() {
      return wall;
    }
  };
}
const spec =
  scenario === "dst"
    ? { cron: "30 1 * * *", timezone: "America/New_York" }
    : { cron: "* * * * * *" };
const definition = (cron) => ({
  name: "sample",
  sourceFile: "sample.js",
  sourcePath: "sample.js",
  exportName: "default",
  definition: defineJob({ ...spec, cron, handler() {} }),
});
if (cluster.isWorker) {
  const name = process.env.JOBS_MEMBER;
  const send = process.send.bind(process);
  let dropped = false;
  const channel = new JobsWorkerChannel(
    {
      on: (event, listener) => process.on(event, listener),
      off: (event, listener) => process.off(event, listener),
      send(packet) {
        if (
          name === "a" &&
          !dropped &&
          ((scenario === "drop-claim" && packet.type === "jobs:claim") ||
            (scenario === "drop-accept" && packet.type === "jobs:accept"))
        ) {
          dropped = true;
          return;
        }
        if (
          scenario === "drop-ack" &&
          name === "b" &&
          packet.type === "jobs:activated"
        )
          return;
        send(packet);
      },
    },
    3000,
  );
  const held = new Map();
  const controls = {
    activate() {
      send({ test: "activated", name });
    },
    drain() {
      send({ test: "drained", name });
    },
    fail(error) {
      console.log(
        JSON.stringify({
          test: "disconnected-gate",
          name,
          error: error.message,
        }),
      );
      setTimeout(() => process.exit(0), 50);
    },
  };
  const manifest = createJobsManifest(
    [
      definition(
        scenario === "manifest-mismatch" && name === "b"
          ? "*/2 * * * * *"
          : spec.cron,
      ),
    ],
    undefined,
    process.cwd(),
    true,
  );
  await channel.bind(manifest, controls);
  send({ test: "ready", manifest });
  process.on("message", async (message) => {
    if (!message?.testCommand) return;
    try {
      if (message.testCommand === "claim") {
        if (controlled) wall = message.point + 5;
        const lease = await channel.claim(
          "sample",
          new Date(message.point),
          new Date(message.point + 1000),
          !!message.skip,
        );
        const started = !!lease?.start?.();
        if (lease) held.set(message.id, lease);
        send({ test: "result", id: message.id, started, point: message.point });
      } else if (message.testCommand === "release") {
        await held.get(message.claim)?.release();
        send({ test: "result", id: message.id });
      } else if (message.testCommand === "close") {
        channel.close();
        process.exit(0);
      }
    } catch (error) {
      send({ test: "result", id: message.id, error: error.message });
    }
  });
} else {
  cluster.setupPrimary({
    exec: fileURLToPath(import.meta.url),
    args: [scenario],
  });
  const current = new Map();
  const arbiter = new JobsArbiter(
    (worker, slot) => current.get(slot) === worker,
    500,
  );
  const workers = [],
    pending = new Map(),
    heldPackets = [],
    records = [];
  let sequence = 0,
    delayed = false;
  function member(name, slot) {
    const worker = cluster.fork({ JOBS_MEMBER: name });
    workers.push(worker);
    current.set(slot, worker);
    arbiter.register(worker, slot, String(slot + 1));
    const nativeSend = worker.send.bind(worker);
    worker.send = (packet, ...args) => {
      if (
        name === "a" &&
        !delayed &&
        ((["drop-offer", "crash-reserved"].includes(scenario) &&
          packet.type === "jobs:offer") ||
          (["late-permit", "crash-permitted"].includes(scenario) &&
            packet.type === "jobs:permit"))
      ) {
        delayed = true;
        heldPackets.push(() => nativeSend(packet));
        const callback = args.find((value) => typeof value === "function");
        callback?.(null);
        return true;
      }
      return nativeSend(packet, ...args);
    };
    let prepared;
    const ready = new Promise((resolve) => {
      prepared = resolve;
    });
    worker.on("message", (packet) => {
      if (packet?.test === "ready") {
        arbiter.ready(worker, packet.manifest);
        prepared();
      } else if (packet?.test === "result") {
        const done = pending.get(packet.id);
        pending.delete(packet.id);
        done?.(packet);
      } else if (packet?.test) records.push(packet);
      else arbiter.handle(worker, packet);
    });
    return { worker, ready };
  }
  const request = (worker, command) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("test command timed out"));
      }, 5000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        value.error ? reject(new Error(value.error)) : resolve(value);
      });
      worker.send({ ...command, id });
    });
  const point = async () => {
    if (controlled) {
      const time = nextJobTime(spec, new Date(wall)).getTime();
      wall = time + 5;
      return time;
    }
    const time = (Math.floor(Date.now() / 1000) + 1) * 1000;
    await delay(time - Date.now() + 5);
    return time;
  };
  const exit = (worker) =>
    new Promise((resolve) => worker.once("exit", resolve));
  const a = member("a", 0),
    b = member("b", 1);
  try {
    await Promise.all([a.ready, b.ready]);
    if (scenario === "manifest-mismatch") {
      await assert.rejects(arbiter.activateInitial(), /manifest mismatch/);
      assert.equal(
        records.filter((record) => record.test === "activated").length,
        0,
      );
    } else if (scenario === "drop-ack") {
      await assert.rejects(
        arbiter.activateInitial(),
        /acknowledgement timed out/,
      );
      const now = await point();
      const result = await request(a.worker, {
        testCommand: "claim",
        point: now,
      });
      assert.equal(result.started, false);
    } else {
      await arbiter.activateInitial();
      const now = await point();
      if (scenario === "long-pause") {
        wall += 2 * 86400000;
        const stale = Math.floor(wall / 1000) * 1000;
        assert.equal(
          (await request(a.worker, { testCommand: "claim", point: stale }))
            .started,
          false,
        );
        const future = await point();
        assert.equal(
          (await request(b.worker, { testCommand: "claim", point: future }))
            .started,
          true,
        );
      } else if (["crash-reserved", "crash-permitted"].includes(scenario)) {
        a.worker.send({ testCommand: "claim", id: -1, point: now });
        await delay(50);
        const exited = exit(a.worker);
        a.worker.kill("SIGKILL");
        await exited;
        assert.equal(
          (await request(b.worker, { testCommand: "claim", point: now }))
            .started,
          false,
        );
        const next = await point();
        assert.equal(
          (await request(b.worker, { testCommand: "claim", point: next }))
            .started,
          true,
        );
      } else if (scenario === "busy-period") {
        const first = await request(a.worker, {
          testCommand: "claim",
          point: now,
        });
        assert.equal(first.started, true);
        const next = await point();
        assert.equal(
          (
            await request(a.worker, {
              testCommand: "claim",
              point: next,
              skip: true,
            })
          ).started,
          false,
        );
        await request(a.worker, { testCommand: "release", claim: first.id });
        assert.equal(
          (await request(b.worker, { testCommand: "claim", point: next }))
            .started,
          false,
        );
        assert.equal(
          (
            await request(b.worker, {
              testCommand: "claim",
              point: await point(),
            })
          ).started,
          true,
        );
      } else if (
        ["drop-offer", "drop-accept", "late-permit"].includes(scenario)
      ) {
        const first = await request(a.worker, {
          testCommand: "claim",
          point: now,
        });
        assert.equal(first.started, false);
        for (const deliver of heldPackets) deliver();
        await delay(30);
        const next = await point();
        const result = await request(b.worker, {
          testCommand: "claim",
          point: next,
        });
        assert.equal(result.started, true);
        await request(b.worker, { testCommand: "release", claim: result.id });
      } else if (scenario === "disconnect-running") {
        const first = await request(a.worker, {
          testCommand: "claim",
          point: now,
        });
        assert.equal(first.started, true);
        const exited = exit(a.worker);
        a.worker.disconnect();
        const immediately = await request(b.worker, {
          testCommand: "claim",
          point: now,
        });
        assert.equal(immediately.started, false);
        await exited;
        const next = await point();
        assert.equal(
          (await request(b.worker, { testCommand: "claim", point: next }))
            .started,
          true,
        );
      } else if (scenario === "crash-running") {
        const first = await request(a.worker, {
          testCommand: "claim",
          point: now,
        });
        assert.equal(first.started, true);
        const exited = exit(a.worker);
        a.worker.kill("SIGKILL");
        await exited;
        assert.equal(
          (await request(b.worker, { testCommand: "claim", point: now }))
            .started,
          false,
        );
        const next = await point();
        assert.equal(
          (await request(b.worker, { testCommand: "claim", point: next }))
            .started,
          true,
        );
      } else {
        const results = await Promise.all(
          [a, b].map((value) =>
            request(value.worker, { testCommand: "claim", point: now }),
          ),
        );
        assert.equal(results.filter((value) => value.started).length, 1);
        const winner = results.findIndex((value) => value.started);
        await request([a, b][winner].worker, {
          testCommand: "release",
          claim: results[winner].id,
        });
        assert.equal(
          (await request(b.worker, { testCommand: "claim", point: now }))
            .started,
          false,
        );
      }
    }
  } finally {
    arbiter.stop();
    await Promise.all(
      workers
        .filter((worker) => !worker.isDead())
        .map(async (worker) => {
          const done = exit(worker);
          worker.kill("SIGKILL");
          await done;
        }),
    );
  }
  console.log(
    JSON.stringify({
      scenario,
      status: "PASS",
      owned: workers.map((worker) => worker.process.pid),
      workersExited: workers.every((worker) => worker.isDead()),
      records,
    }),
  );
}
