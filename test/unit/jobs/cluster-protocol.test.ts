import { EventEmitter } from "node:events";
import type { Worker } from "node:cluster";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsArbiter } from "../../../src/lib/cluster/jobs-arbiter.js";
import { JobsWorkerChannel } from "../../../src/lib/jobs/cluster-worker.js";
import {
  createJobsManifest,
  type JobsPacket,
} from "../../../src/lib/jobs/cluster-protocol.js";
import { defineJob } from "../../../src/lib/jobs/define-job.js";
import type { VextLoadedJob } from "../../../src/lib/jobs/types.js";

const definition = (cron = "* * * * * *"): VextLoadedJob => ({
  name: "sample",
  definition: defineJob({ cron, handler() {} }),
  sourceFile: "jobs/sample.ts",
  sourcePath: "sample.ts",
  exportName: "default",
});
function harness() {
  const current = new Map<number, Worker>();
  const arbiter = new JobsArbiter(
    (worker, slot) => current.get(slot) === worker,
    1000,
  );
  let count = 0;
  const members: ReturnType<typeof member>[] = [];
  function member(
    slot: number,
    cron?: string,
    config?: Parameters<typeof createJobsManifest>[1],
  ) {
    const host = new EventEmitter();
    const peer = new EventEmitter();
    const received: JobsPacket[] = [];
    const sent: JobsPacket[] = [];
    let connected = true;
    let holdDrain = false;
    let holdPermit = false;
    let holdAck = false;
    const worker = Object.assign(host, {
      id: ++count,
      isConnected: () => connected,
      send(packet: JobsPacket, callback: () => void) {
        received.push(packet);
        callback();
        if (
          (holdDrain && packet.type === "jobs:drain") ||
          (holdPermit && packet.type === "jobs:permit")
        )
          return;
        peer.emit("message", packet);
      },
    }) as unknown as Worker;
    arbiter.register(worker, slot, String(count));
    host.on("message", (packet) => {
      sent.push(packet);
      arbiter.handle(worker, packet);
    });
    const channel = new JobsWorkerChannel({
      on: (event, listener) => {
        peer.on(event, listener);
      },
      off: (event, listener) => {
        peer.off(event, listener);
      },
      send: (packet) => {
        if (!(holdAck && packet.type === "jobs:activated"))
          host.emit("message", packet);
      },
    });
    const controls = { activate: vi.fn(), drain: vi.fn(), fail: vi.fn() };
    const manifest = createJobsManifest(
      [definition(cron)],
      config,
      process.cwd(),
      true,
    );
    const ready = async () => {
      await channel.bind(manifest, controls);
      arbiter.ready(worker, manifest);
    };
    const value = {
      worker,
      channel,
      manifest,
      controls,
      received,
      sent,
      ready,
      setCurrent: () => current.set(slot, worker),
      holdDrain: (value: boolean) => {
        holdDrain = value;
      },
      holdPermit: (value: boolean) => {
        holdPermit = value;
      },
      holdAck: (value: boolean) => {
        holdAck = value;
      },
      deliverToMaster: (packet: JobsPacket) => host.emit("message", packet),
      deliver: (packet: JobsPacket) => peer.emit("message", packet),
      exit: () => {
        connected = false;
        host.emit("exit");
      },
      disconnect: () => {
        connected = false;
        host.emit("disconnect");
        peer.emit("disconnect");
      },
    };
    members.push(value);
    return value;
  }
  return {
    arbiter,
    member,
    close() {
      arbiter.stop();
      for (const member of members) {
        member.channel.close();
        member.exit();
      }
    },
  };
}
afterEach(() => vi.useRealTimers());

describe("built-in Jobs arbitration", () => {
  it.each(["ipc", "redis"])(
    "keeps a trusted pre-activation stop final in %s mode",
    async (mode) => {
      const peer = new EventEmitter();
      const identity = { epoch: "master", generation: "worker", slot: 0 };
      const sent: JobsPacket[] = [];
      const channel = new JobsWorkerChannel({
        on: (event, listener) => {
          peer.on(event, listener);
        },
        off: (event, listener) => {
          peer.off(event, listener);
        },
        send(packet) {
          sent.push(packet);
          if (packet.type === "jobs:hello")
            peer.emit("message", {
              version: 1,
              type: "jobs:hello-ok",
              ...identity,
            });
        },
      });
      const controls = { activate: vi.fn(), drain: vi.fn(), fail: vi.fn() };
      const manifest = createJobsManifest(
        [definition()],
        mode === "redis"
          ? { redis: { url: "redis://127.0.0.1:6379" } }
          : undefined,
        process.cwd(),
        true,
      );
      try {
        await channel.bind(manifest, controls);
        const packet = {
          version: 1 as const,
          ...identity,
          activationId: "delayed",
        };
        peer.emit("message", { ...packet, type: "jobs:stop" });
        peer.emit("message", { ...packet, type: "jobs:stop" });
        peer.emit("message", {
          ...packet,
          type: "jobs:activate",
          manifestDigest: manifest.digest,
        });
        expect(controls.drain).toHaveBeenCalledOnce();
        expect(controls.activate).not.toHaveBeenCalled();
        expect(sent.some((item) => item.type === "jobs:activated")).toBe(false);
        expect(
          await channel.claim(
            "sample",
            new Date(),
            new Date(Date.now() + 1000),
            false,
          ),
        ).toBeNull();
      } finally {
        channel.close();
      }
    },
  );
  it("ignores foreign or empty stops and another activation's stop", async () => {
    const h = harness();
    const a = h.member(0);
    try {
      a.setCurrent();
      await a.ready();
      const identity = a.received.find(
        (packet) => packet.type === "jobs:hello-ok",
      )!;
      for (const override of [
        { epoch: "foreign" },
        { generation: "foreign" },
        { slot: 99 },
        { activationId: "" },
        { activationId: undefined },
      ])
        a.deliver({
          ...identity,
          type: "jobs:stop",
          activationId: "pending",
          ...override,
        });
      expect(a.controls.drain).not.toHaveBeenCalled();
      await h.arbiter.activateInitial();
      expect(a.controls.activate).toHaveBeenCalledOnce();
      a.deliver({
        ...identity,
        type: "jobs:stop",
        activationId: "old-activation",
      });
      expect(a.controls.drain).not.toHaveBeenCalled();
      const activation = a.received.find(
        (packet) => packet.type === "jobs:activate",
      )!;
      a.deliver({ ...activation, type: "jobs:stop" });
      expect(a.controls.drain).toHaveBeenCalledOnce();
    } finally {
      h.close();
    }
  });
  it.each([
    {
      field: "cron",
      cron: "*/2 * * * * *",
      config: { redis: { url: "redis://127.0.0.1:6379", leaseTtl: 1000 } },
    },
    {
      field: "timezone",
      config: {
        timezone: "Asia/Shanghai",
        redis: { url: "redis://127.0.0.1:6379", leaseTtl: 1000 },
      },
    },
    {
      field: "leaseTtl",
      config: { redis: { url: "redis://127.0.0.1:6379", leaseTtl: 2000 } },
    },
    {
      field: "redis.target",
      config: { redis: { url: "redis://127.0.0.1:6380", leaseTtl: 1000 } },
    },
    {
      field: "redis.keyPrefix",
      config: {
        redis: {
          url: "redis://127.0.0.1:6379",
          leaseTtl: 1000,
          keyPrefix: "different",
        },
      },
    },
    {
      field: "globalEnabled",
      config: {
        enabled: false,
        redis: { url: "redis://127.0.0.1:6379", leaseTtl: 1000 },
      },
    },
    { field: "mode", config: undefined },
  ])(
    "reports the mismatched $field without draining the valid old member",
    async ({ field, cron, config }) => {
      const h = harness();
      const old = h.member(0, undefined, {
        redis: { url: "redis://127.0.0.1:6379", leaseTtl: 1000 },
      });
      const candidate = h.member(0, cron, config);
      try {
        old.setCurrent();
        await old.ready();
        await h.arbiter.activateInitial();
        await expect(candidate.ready()).rejects.toThrow(field);
        expect(old.controls.drain).not.toHaveBeenCalled();
        expect(candidate.controls.activate).not.toHaveBeenCalled();
      } finally {
        h.close();
      }
    },
  );
  it("identifies an incompatible manifest version before rejecting a replacement", async () => {
    const h = harness();
    const old = h.member(0);
    const candidate = h.member(0);
    try {
      old.setCurrent();
      await old.ready();
      await h.arbiter.activateInitial();
      expect(() =>
        h.arbiter.ready(candidate.worker, {
          ...candidate.manifest,
          version: 2,
        }),
      ).toThrow("version mismatch");
      expect(old.controls.drain).not.toHaveBeenCalled();
      expect(candidate.controls.activate).not.toHaveBeenCalled();
    } finally {
      h.close();
    }
  });
  it("waits for the explicit initial barrier and gives one committed permit per point", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const a = h.member(0);
    const b = h.member(1);
    try {
      a.setCurrent();
      b.setCurrent();
      await a.ready();
      await b.ready();
      expect(a.controls.activate).not.toHaveBeenCalled();
      expect(
        await a.channel.claim("sample", new Date(1000), new Date(2000), false),
      ).toBeNull();
      await h.arbiter.activateInitial();
      expect(a.controls.activate).toHaveBeenCalledOnce();
      vi.setSystemTime(1000);
      const [one, two] = await Promise.all([
        a.channel.claim("sample", new Date(1000), new Date(2000), false),
        b.channel.claim("sample", new Date(1000), new Date(2000), false),
      ]);
      expect([one, two].filter(Boolean)).toHaveLength(1);
      const lease = one ?? two!;
      expect(lease.start!()).toBe(true);
      await lease.release();
      expect(
        await b.channel.claim("sample", new Date(1000), new Date(2000), false),
      ).toBeNull();
    } finally {
      h.close();
    }
  });
  it("rejects manifest disagreement before creating any Jobs activation", async () => {
    const h = harness();
    const a = h.member(0);
    const b = h.member(1, "*/2 * * * * *");
    try {
      a.setCurrent();
      b.setCurrent();
      await a.ready();
      await b.ready();
      await expect(h.arbiter.activateInitial()).rejects.toThrow(
        "manifest mismatch",
      );
      expect(a.controls.activate).not.toHaveBeenCalled();
      expect(b.controls.activate).not.toHaveBeenCalled();
    } finally {
      h.close();
    }
  });
  it("retains running ownership through drain and slot replacement until exact settlement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const old = h.member(0);
    const replacement = h.member(0);
    try {
      old.setCurrent();
      await old.ready();
      await h.arbiter.activateInitial();
      vi.setSystemTime(1000);
      const lease = (await old.channel.claim(
        "sample",
        new Date(1000),
        new Date(2000),
        false,
      ))!;
      expect(lease.start!()).toBe(true);
      await replacement.ready();
      await h.arbiter.drain(old.worker);
      expect(old.controls.drain).toHaveBeenCalledOnce();
      replacement.setCurrent();
      await h.arbiter.activate(replacement.worker);
      vi.setSystemTime(2000);
      expect(
        await replacement.channel.claim(
          "sample",
          new Date(2000),
          new Date(3000),
          false,
        ),
      ).toBeNull();
      await lease.release();
      vi.setSystemTime(3000);
      const next = await replacement.channel.claim(
        "sample",
        new Date(3000),
        new Date(4000),
        false,
      );
      expect(next).not.toBeNull();
      await next!.release();
    } finally {
      h.close();
    }
  });
  it("does not treat disconnect as actual exit for committed ownership", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const a = h.member(0);
    const b = h.member(1);
    try {
      a.setCurrent();
      b.setCurrent();
      await a.ready();
      await b.ready();
      await h.arbiter.activateInitial();
      vi.setSystemTime(1000);
      const lease = (await a.channel.claim(
        "sample",
        new Date(1000),
        new Date(2000),
        false,
      ))!;
      lease.start!();
      a.disconnect();
      vi.setSystemTime(2000);
      expect(
        await b.channel.claim("sample", new Date(2000), new Date(3000), false),
      ).toBeNull();
      a.exit();
      vi.setSystemTime(3000);
      const next = await b.channel.claim(
        "sample",
        new Date(3000),
        new Date(4000),
        false,
      );
      expect(next).not.toBeNull();
      await next!.release();
    } finally {
      h.close();
    }
  });
  it("abandons a withheld permit permanently and never revives it after drain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const a = h.member(0);
    try {
      a.setCurrent();
      await a.ready();
      await h.arbiter.activateInitial();
      vi.setSystemTime(1000);
      a.holdPermit(true);
      const claim = a.channel.claim(
        "sample",
        new Date(1000),
        new Date(2000),
        false,
      );
      const permit = a.received.find(
        (packet) => packet.type === "jobs:permit",
      )!;
      expect(permit).toBeDefined();
      await h.arbiter.drain(a.worker);
      expect(await claim).toBeNull();
      a.deliver(permit);
      expect(
        a.sent.filter((packet) => packet.type === "jobs:never-started").length,
      ).toBeGreaterThan(0);
      expect(
        await a.channel.claim("sample", new Date(2000), new Date(3000), false),
      ).toBeNull();
    } finally {
      h.close();
    }
  });
  it("requires an exact drain receipt and ignores forged generation packets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const a = h.member(0);
    try {
      a.setCurrent();
      await a.ready();
      await h.arbiter.activateInitial();
      a.holdDrain(true);
      let completed = false;
      const drain = h.arbiter.drain(a.worker).then(() => {
        completed = true;
      });
      const packet = a.received.find((packet) => packet.type === "jobs:drain")!;
      h.arbiter.handle(a.worker, {
        ...packet,
        type: "jobs:drained",
        generation: "forged",
      });
      await Promise.resolve();
      expect(completed).toBe(false);
      a.holdDrain(false);
      a.deliver(packet);
      await drain;
      expect(completed).toBe(true);
    } finally {
      h.close();
    }
  });
  it("shares repeated drain requests without replacing the outstanding receipt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const a = h.member(0);
    try {
      a.setCurrent();
      await a.ready();
      await h.arbiter.activateInitial();
      a.holdDrain(true);
      const first = h.arbiter.drain(a.worker);
      const second = h.arbiter.drain(a.worker);
      expect(
        a.received.filter((packet) => packet.type === "jobs:drain"),
      ).toHaveLength(1);
      const packet = a.received.find((packet) => packet.type === "jobs:drain")!;
      a.holdDrain(false);
      a.deliver(packet);
      await Promise.all([first, second]);
      await h.arbiter.drain(a.worker);
      expect(
        a.received.filter((packet) => packet.type === "jobs:drain"),
      ).toHaveLength(1);
    } finally {
      h.close();
    }
  });
  it("retains an exact late drain receipt for the next replacement attempt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const a = h.member(0);
    try {
      a.setCurrent();
      await a.ready();
      await h.arbiter.activateInitial();
      a.holdDrain(true);
      const failure = expect(h.arbiter.drain(a.worker)).rejects.toThrow(
        "receipt unknown",
      );
      const packet = a.received.find((packet) => packet.type === "jobs:drain")!;
      await vi.advanceTimersByTimeAsync(1000);
      await failure;
      const sent = a.received.filter(
        (packet) => packet.type === "jobs:drain",
      ).length;
      a.holdDrain(false);
      a.deliver(packet);
      await h.arbiter.drain(a.worker);
      expect(
        a.received.filter((packet) => packet.type === "jobs:drain"),
      ).toHaveLength(sent);
      expect(
        await a.channel.claim("sample", new Date(1000), new Date(2000), false),
      ).toBeNull();
    } finally {
      h.close();
    }
  });
  it("consumes a locally busy point before another worker can request it after settlement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const a = h.member(0);
    const b = h.member(1);
    try {
      a.setCurrent();
      b.setCurrent();
      await a.ready();
      await b.ready();
      await h.arbiter.activateInitial();
      vi.setSystemTime(1000);
      const lease = (await a.channel.claim(
        "sample",
        new Date(1000),
        new Date(2000),
        false,
      ))!;
      lease.start!();
      vi.setSystemTime(2000);
      expect(
        await a.channel.claim("sample", new Date(2000), new Date(3000), true),
      ).toBeNull();
      await lease.release();
      expect(
        await b.channel.claim("sample", new Date(2000), new Date(3000), false),
      ).toBeNull();
    } finally {
      h.close();
    }
  });
  it("refuses a stale initial snapshot when an ACKed member exits and a replacement arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const a = h.member(0);
    const b = h.member(1);
    try {
      a.setCurrent();
      b.setCurrent();
      await a.ready();
      await b.ready();
      b.holdAck(true);
      const barrier = h.arbiter.activateInitial();
      const failure = expect(barrier).rejects.toThrow("membership changed");
      a.exit();
      const c = h.member(0);
      c.setCurrent();
      await c.ready();
      const activation = b.received.find(
        (packet) => packet.type === "jobs:activate",
      )!;
      b.deliverToMaster({ ...activation, type: "jobs:activated" });
      await failure;
      expect(h.arbiter.isInitialized).toBe(false);
      expect(c.controls.activate).not.toHaveBeenCalled();
    } finally {
      h.close();
    }
  });
  it("closes the activated local gate on ACK timeout with the exact activation identity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = harness();
    const a = h.member(0);
    try {
      a.setCurrent();
      await a.ready();
      a.holdAck(true);
      const barrier = h.arbiter.activateInitial();
      const failure = expect(barrier).rejects.toThrow(
        "acknowledgement timed out",
      );
      expect(a.controls.activate).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1000);
      await failure;
      expect(a.controls.drain).toHaveBeenCalledOnce();
      const stop = a.received.find(
        (packet) =>
          packet.type === "jobs:stop" && packet.reason === "activation-timeout",
      )!;
      expect(stop.activationId).toBe(
        a.received.find((packet) => packet.type === "jobs:activate")!
          .activationId,
      );
      expect(
        await a.channel.claim("sample", new Date(1000), new Date(2000), false),
      ).toBeNull();
    } finally {
      h.close();
    }
  });
});
