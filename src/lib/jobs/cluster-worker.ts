import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  isJobsPacket,
  type JobsIdentity,
  type JobsManifest,
  type JobsPacket,
} from "./cluster-protocol.js";
import type { JobCoordinator, JobLease } from "./redis-coordinator.js";

interface Transport {
  send(packet: JobsPacket): void;
  on(
    event: "message" | "disconnect",
    listener: (value?: unknown) => void,
  ): void;
  off(
    event: "message" | "disconnect",
    listener: (value?: unknown) => void,
  ): void;
}
interface Controls {
  activate(): void;
  drain(reason: Error): void;
  fail(reason: Error): void;
}
interface Claim {
  job: string;
  requestId: string;
  activationId: string;
  scheduledAt: number;
  deadline: number;
  expiresAt: number;
  token?: string;
  state: "pending" | "permitted" | "running" | "abandoned" | "settled";
  controller: AbortController;
  resolve(value: JobLease | null): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Installed by workerMain, never inferred from environment variables or cluster.isWorker. */
let builtin: JobsWorkerChannel | undefined;
export function getBuiltinJobsWorker(): JobsWorkerChannel | undefined {
  return builtin;
}
export function installBuiltinJobsWorker(): JobsWorkerChannel {
  if (builtin) return builtin;
  builtin = new JobsWorkerChannel({
    send(packet) {
      if (!process.connected || !process.send)
        throw new Error("Jobs IPC disconnected");
      process.send(packet, () => {});
    },
    on(event, listener) {
      process.on(event, listener);
    },
    off(event, listener) {
      process.off(event, listener);
    },
  });
  return builtin;
}

/** Per-process controller; all packets are fenced by the actual Master handshake. */
export class JobsWorkerChannel implements JobCoordinator {
  manifest?: JobsManifest;
  private identity?: JobsIdentity;
  private controls?: Controls;
  private activationId = "";
  private draining = false;
  private disconnected = false;
  private claims = new Map<string, Claim>();
  private handshake?: {
    resolve(): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  };
  private readonly onMessage = (value?: unknown) => this.handle(value);
  private readonly onDisconnect = () => {
    this.disconnected = true;
    const error = new Error("[vextjs] Jobs Master IPC disconnected");
    this.stop(error);
    this.handshake?.reject(error);
    clearTimeout(this.handshake?.timer);
    this.handshake = undefined;
    this.controls?.fail(error);
  };

  constructor(
    private readonly transport: Transport,
    private readonly timeout = 10000,
  ) {
    transport.on("message", this.onMessage);
    transport.on("disconnect", this.onDisconnect);
  }
  diagnostics(): Partial<JobsIdentity> & { activationId: string } {
    return { ...this.identity, activationId: this.activationId };
  }

  async bind(manifest: JobsManifest, controls: Controls): Promise<void> {
    if (this.controls)
      throw new Error("[vextjs] Jobs Worker runtime already bound");
    this.manifest = manifest;
    this.controls = controls;
    if (!manifest.jobs.some((job) => job.enabled)) return;
    await new Promise<void>((resolve, reject) => {
      this.handshake = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.handshake = undefined;
          reject(
            new Error("[vextjs] Jobs built-in Master handshake timed out"),
          );
        }, this.timeout),
      };
      try {
        this.transport.send({ type: "jobs:hello", version: 1 });
      } catch {
        this.onDisconnect();
      }
    });
  }

  private send(packet: Omit<JobsPacket, "version">): void {
    if (this.disconnected || !this.identity) return;
    try {
      this.transport.send({ ...packet, version: 1, ...this.identity });
    } catch {
      this.onDisconnect();
    }
  }

  private handle(value: unknown): void {
    if (!isJobsPacket(value)) return;
    if (value.type === "jobs:hello-ok") {
      if (
        !this.handshake ||
        this.identity ||
        !value.epoch ||
        !value.generation ||
        !Number.isSafeInteger(value.slot) ||
        value.slot! < 0
      )
        return;
      this.identity = {
        epoch: value.epoch,
        generation: value.generation,
        slot: value.slot!,
      };
      clearTimeout(this.handshake.timer);
      this.handshake.resolve();
      this.handshake = undefined;
      return;
    }
    if (
      !this.identity ||
      value.epoch !== this.identity.epoch ||
      value.generation !== this.identity.generation ||
      value.slot !== this.identity.slot
    )
      return;
    if (value.type === "jobs:activate") {
      if (
        this.draining ||
        !this.controls ||
        !value.activationId ||
        value.manifestDigest !== this.manifest?.digest
      )
        return;
      if (this.activationId && this.activationId !== value.activationId) return;
      try {
        if (!this.activationId) {
          this.controls.activate();
          this.activationId = value.activationId;
        }
        this.send({
          type: "jobs:activated",
          activationId: this.activationId,
          manifestDigest: this.manifest!.digest,
        });
      } catch (error) {
        const reason =
          error instanceof Error ? error : new Error(String(error));
        this.stop(reason);
        this.controls.fail(reason);
      }
      return;
    }
    if (value.type === "jobs:drain" || value.type === "jobs:stop") {
      // A trusted stop can precede its delayed activate packet. Fence this
      // process permanently without accepting another active generation's ID.
      const stopBeforeActivation =
        value.type === "jobs:stop" &&
        !this.activationId &&
        !!value.activationId;
      if (value.activationId !== this.activationId && !stopBeforeActivation)
        return;
      this.stop(
        new Error(
          value.type === "jobs:drain"
            ? "[vextjs] Jobs Worker draining"
            : "[vextjs] Jobs Master stopping",
        ),
      );
      if (value.type === "jobs:drain" && value.requestId)
        this.send({
          type: "jobs:drained",
          requestId: value.requestId,
          activationId: this.activationId,
        });
      return;
    }
    const claim = value.requestId
      ? this.claims.get(value.requestId)
      : undefined;
    if (
      !claim ||
      value.job !== claim.job ||
      value.activationId !== claim.activationId
    ) {
      // A late permit must be explicitly settled, but can never revive a discarded request.
      if (value.type === "jobs:permit" && value.token)
        this.send({ ...value, type: "jobs:never-started" });
      return;
    }
    if (value.type === "jobs:offer") {
      if (!this.eligible(claim) || claim.state !== "pending" || !value.token) {
        this.abandon(claim);
        return;
      }
      if (claim.token && claim.token !== value.token) return;
      claim.token = value.token;
      this.send({ type: "jobs:accept", ...this.fields(claim) });
    } else if (value.type === "jobs:permit") {
      if (!claim.token || value.token !== claim.token) return;
      if (claim.state === "running") return;
      if (!this.eligible(claim) || claim.state !== "pending") {
        this.abandon(claim, true);
        return;
      }
      claim.state = "permitted";
      claim.resolve(this.lease(claim));
    } else if (value.type === "jobs:skip") this.abandon(claim);
    else if (value.type === "jobs:cancel-run" && value.token === claim.token) {
      if (claim.state === "running")
        claim.controller.abort(
          new Error("[vextjs] Jobs permit cancellation requested"),
        );
      else this.abandon(claim, true);
    }
  }

  private fields(
    claim: Claim,
  ): Pick<
    JobsPacket,
    "job" | "requestId" | "activationId" | "scheduledAt" | "token"
  > {
    return {
      job: claim.job,
      requestId: claim.requestId,
      activationId: claim.activationId,
      scheduledAt: claim.scheduledAt,
      token: claim.token,
    };
  }
  private eligible(claim: Claim): boolean {
    return (
      !this.draining &&
      !this.disconnected &&
      claim.activationId === this.activationId &&
      performance.now() < claim.deadline &&
      Date.now() < claim.expiresAt
    );
  }
  private abandon(claim: Claim, committed = false): void {
    if (
      claim.state === "running" ||
      claim.state === "settled" ||
      claim.state === "abandoned"
    )
      return;
    claim.state = "abandoned";
    clearTimeout(claim.timer);
    claim.resolve(null);
    this.send({
      type: committed || claim.token ? "jobs:never-started" : "jobs:cancel",
      ...this.fields(claim),
    });
    this.claims.delete(claim.requestId);
  }
  private lease(claim: Claim): JobLease {
    return {
      signal: claim.controller.signal,
      valid: () =>
        claim.state === "running"
          ? !this.disconnected
          : claim.state === "permitted" && this.eligible(claim),
      start: () => {
        if (claim.state !== "permitted" || !this.eligible(claim)) {
          this.abandon(claim, true);
          return false;
        }
        claim.state = "running";
        clearTimeout(claim.timer);
        return true;
      },
      release: async () => {
        if (claim.state === "running") {
          claim.state = "settled";
          this.send({ type: "jobs:complete", ...this.fields(claim) });
          this.claims.delete(claim.requestId);
        } else this.abandon(claim, true);
      },
    };
  }

  claim(
    job: string,
    scheduledAt: Date,
    expiresAt: Date,
    skip: boolean,
  ): Promise<JobLease | null> {
    if (!this.activationId || this.draining || this.disconnected)
      return Promise.resolve(null);
    if (skip || [...this.claims.values()].some((claim) => claim.job === job)) {
      this.send({
        type: "jobs:busy",
        job,
        activationId: this.activationId,
        requestId: randomUUID(),
        scheduledAt: scheduledAt.getTime(),
      });
      return Promise.resolve(null);
    }
    if (this.claims.size >= 2048) return Promise.resolve(null);
    return new Promise((resolve) => {
      const claim: Claim = {
        job,
        requestId: randomUUID(),
        activationId: this.activationId,
        scheduledAt: scheduledAt.getTime(),
        deadline: performance.now() + 2000,
        expiresAt: expiresAt.getTime(),
        state: "pending",
        controller: new AbortController(),
        resolve,
        timer: setTimeout(() => this.abandon(claim), 2000),
      };
      claim.timer.unref();
      this.claims.set(claim.requestId, claim);
      this.send({ type: "jobs:claim", ...this.fields(claim) });
    });
  }

  /** Receipt means admission is synchronously closed, never that handlers have stopped. */
  stop(reason: Error): void {
    if (this.draining) return;
    this.draining = true;
    this.controls?.drain(reason);
    for (const claim of [...this.claims.values()]) {
      if (claim.state === "running") claim.controller.abort(reason);
      else this.abandon(claim);
    }
  }
  close(): void {
    this.stop(new Error("[vextjs] Jobs Worker closing"));
    // Keep the channel while running handlers settle; their exact receipts still matter.
    if (!this.claims.size) {
      this.transport.off("message", this.onMessage);
      this.transport.off("disconnect", this.onDisconnect);
    }
  }
}
