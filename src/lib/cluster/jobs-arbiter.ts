import type { Worker } from "node:cluster";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { nextJobTime } from "../jobs/schedule.js";
import {
  createJobsManifest,
  JOBS_PROTOCOL_VERSION,
  isJobsPacket,
  validateJobsManifest,
  type JobsIdentity,
  type JobsManifest,
  type JobsPacket,
  type ManifestJob,
} from "../jobs/cluster-protocol.js";

interface Waiter {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  retry?: ReturnType<typeof setInterval>;
}
interface Member extends JobsIdentity {
  worker: Worker;
  handshaken: boolean;
  exited: boolean;
  active: boolean;
  draining: boolean;
  activationId: string;
  manifest?: JobsManifest;
  activation?: Waiter;
  drain?: Waiter & { requestId: string };
  drainPromise?: Promise<void>;
  drained?: boolean;
}
interface Owner {
  member: Member;
  activationId: string;
  requestId: string;
  token: string;
  scheduledAt: number;
  deadline: number;
}
interface JobState {
  spec: ManifestJob;
  due: Date | null;
  next: Date | null;
  last: number;
  reservation?: Owner & { timer: ReturnType<typeof setTimeout> };
  run?: Owner;
}

/** Master-only state. Worker identity always comes from the captured channel. */
export class JobsArbiter {
  readonly epoch = randomUUID();
  private readonly members = new Map<Worker, Member>();
  private readonly jobs = new Map<string, JobState>();
  private manifest?: JobsManifest;
  private closing = false;
  private initialized = false;
  private membershipRevision = 0;
  get isInitialized(): boolean {
    return this.initialized;
  }

  constructor(
    private readonly isCurrent: (worker: Worker, slot: number) => boolean,
    private readonly readyTimeout: number,
  ) {}

  register(worker: Worker, slot: number, generation: string): void {
    const member: Member = {
      worker,
      slot,
      generation,
      epoch: this.epoch,
      handshaken: false,
      exited: false,
      active: false,
      draining: false,
      activationId: "",
    };
    this.members.set(worker, member);
    this.membershipRevision++;
    worker.once("disconnect", () => {
      this.membershipRevision++;
      member.active = false;
      this.revokeReservations(member);
      this.rejectWaiter(
        member.activation,
        "IPC disconnected during Jobs activation",
      );
      // A disconnected process may still execute its committed handler.
    });
    worker.once("exit", () => {
      this.membershipRevision++;
      member.exited = true;
      member.active = false;
      this.revokeReservations(member);
      for (const state of this.jobs.values())
        if (state.run?.member === member) state.run = undefined;
      this.rejectWaiter(
        member.activation,
        "Worker exited during Jobs activation",
      );
      if (member.drain) this.resolveWaiter(member.drain);
      this.members.delete(worker);
    });
  }

  ready(worker: Worker, value: unknown): void {
    const member = this.members.get(worker);
    if (!member || member.exited)
      throw new Error("[vextjs] unknown Jobs worker");
    const manifest = value ?? createJobsManifest([], undefined, "", true);
    if (!validateJobsManifest(manifest)) {
      const versionMismatch =
        manifest !== null &&
        typeof manifest === "object" &&
        "version" in manifest &&
        manifest.version !== JOBS_PROTOCOL_VERSION;
      throw new Error(
        `[vextjs] invalid Jobs manifest${versionMismatch ? " (version mismatch)" : ""}`,
      );
    }
    if (manifest.jobs.some((job) => job.enabled) && !member.handshaken)
      throw new Error(
        "[vextjs] active Jobs require the built-in Master handshake",
      );
    member.manifest = manifest;
    this.membershipRevision++;
    if (this.initialized) this.assertManifest(member);
  }

  private assertManifest(member: Member): void {
    if (
      !member.manifest ||
      (this.manifest && this.manifest.digest !== member.manifest.digest)
    ) {
      const previous = this.manifest?.jobs ?? [];
      const actual = member.manifest?.jobs ?? [];
      const names = [
        ...new Set([...previous, ...actual].map((job) => job.name)),
      ];
      const changed = names.flatMap((name) => {
        const before = previous.find((job) => job.name === name);
        const after = actual.find((job) => job.name === name);
        if (!before || !after)
          return [`${name} (${before ? "missing" : "added"})`];
        const fields = [
          ...new Set([...Object.keys(before), ...Object.keys(after)]),
        ].filter(
          (key) =>
            JSON.stringify(before[key as keyof ManifestJob]) !==
            JSON.stringify(after[key as keyof ManifestJob]),
        );
        return fields.length ? [`${name} (${fields.join(", ")})`] : [];
      });
      for (const key of ["version", "globalEnabled", "mode"] as const)
        if (this.manifest?.[key] !== member.manifest?.[key]) changed.push(key);
      for (const key of ["target", "keyPrefix"] as const)
        if (this.manifest?.redis?.[key] !== member.manifest?.redis?.[key])
          changed.push(`redis.${key}`);
      throw new Error(
        `[vextjs] Jobs manifest mismatch: ${changed.join("; ") || "manifest unavailable"}.`,
      );
    }
  }

  /** Called after all startup attempts, never from forkWorker's appReady wait. */
  async activateInitial(): Promise<void> {
    const currentReady = () =>
      [...this.members.values()].filter(
        (member) =>
          member.manifest &&
          !member.exited &&
          member.worker.isConnected() &&
          this.isCurrent(member.worker, member.slot),
      );
    const members = currentReady();
    const revision = this.membershipRevision;
    if (!members.length)
      throw new Error("[vextjs] Jobs activation has no valid ready workers");
    this.manifest = members[0]!.manifest;
    for (const member of members) this.assertManifest(member);
    const anchor = new Date();
    if (this.manifest!.mode === "ipc")
      for (const spec of this.manifest!.jobs.filter((job) => job.enabled)) {
        const due = nextJobTime(spec, anchor, spec.timezone);
        if (!due)
          throw new Error(
            `[vextjs] Job ${spec.name} has no future point at activation`,
          );
        this.jobs.set(spec.name, {
          spec,
          due,
          next: nextJobTime(spec, due, spec.timezone),
          last: -1,
        });
      }
    try {
      await Promise.all(members.map((member) => this.activate(member.worker)));
      const actual = currentReady();
      if (
        this.membershipRevision !== revision ||
        actual.length !== members.length ||
        members.some(
          (member) =>
            !actual.includes(member) ||
            member.draining ||
            (member.manifest!.jobs.some((job) => job.enabled) &&
              !member.active),
        )
      )
        throw new Error(
          "[vextjs] Jobs initial membership changed during activation; the old snapshot cannot commit",
        );
      this.initialized = true;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async activate(worker: Worker): Promise<void> {
    const member = this.members.get(worker);
    if (
      !member ||
      this.closing ||
      member.exited ||
      member.draining ||
      !this.isCurrent(worker, member.slot)
    )
      throw new Error(
        "[vextjs] Jobs activation requires the current live slot owner",
      );
    this.assertManifest(member);
    if (!member.manifest!.jobs.some((job) => job.enabled)) return;
    member.activationId = randomUUID();
    return new Promise<void>((resolve, reject) => {
      member.activation = {
        resolve,
        reject,
        timer: setTimeout(() => {
          member.active = false;
          member.draining = true;
          this.revokeReservations(member);
          this.send(member, {
            type: "jobs:stop",
            activationId: member.activationId,
            reason: "activation-timeout",
          });
          reject(
            new Error(
              "[vextjs] phase=jobs-activation: acknowledgement timed out",
            ),
          );
        }, this.readyTimeout),
      };
      member.activation.timer.unref();
      this.send(member, {
        type: "jobs:activate",
        activationId: member.activationId,
        manifestDigest: member.manifest!.digest,
      });
    });
  }

  /** Close Master admission first; commit a replacement only after this resolves. */
  async drain(worker: Worker, timeout = this.readyTimeout): Promise<void> {
    const member = this.members.get(worker);
    if (!member || member.exited) return;
    if (member.drained) return;
    if (member.drainPromise) return member.drainPromise;
    member.active = false;
    member.draining = true;
    this.revokeReservations(member);
    if (!member.manifest?.jobs.some((job) => job.enabled)) return;
    const requestId = member.drain?.requestId ?? randomUUID();
    member.drainPromise = new Promise<void>((resolve, reject) => {
      const packet = {
        type: "jobs:drain",
        activationId: member.activationId,
        requestId,
      };
      const waiter = {
        requestId,
        resolve,
        reject,
        timer: setTimeout(() => {
          clearInterval(waiter.retry);
          member.drainPromise = undefined;
          reject(
            new Error(
              "[vextjs] Jobs drain receipt unknown; replacement remains inactive",
            ),
          );
        }, timeout),
        retry: setInterval(
          () => this.send(member, packet),
          Math.min(500, Math.max(50, Math.floor(timeout / 4))),
        ),
      };
      waiter.timer.unref();
      waiter.retry.unref();
      member.drain = waiter;
      this.send(member, packet);
    });
    return member.drainPromise;
  }

  handle(worker: Worker, value: unknown): boolean {
    if (!isJobsPacket(value)) return false;
    const member = this.members.get(worker);
    if (!member || member.exited) return true;
    if (value.type === "jobs:hello") {
      member.handshaken = true;
      this.send(member, { type: "jobs:hello-ok" });
      return true;
    }
    if (
      value.epoch !== this.epoch ||
      value.generation !== member.generation ||
      value.slot !== member.slot
    )
      return true;
    if (value.type === "jobs:activated") {
      if (
        member.activation &&
        !member.draining &&
        value.activationId === member.activationId &&
        value.manifestDigest === member.manifest?.digest &&
        this.isCurrent(worker, member.slot)
      ) {
        member.active = true;
        this.resolveWaiter(member.activation);
        member.activation = undefined;
      }
    } else if (value.type === "jobs:drained") {
      if (
        member.drain &&
        value.requestId === member.drain.requestId &&
        value.activationId === member.activationId
      ) {
        member.drained = true;
        this.resolveWaiter(member.drain);
        member.drain = undefined;
        member.drainPromise = undefined;
      }
    } else if (value.type === "jobs:busy") {
      const state = value.job ? this.jobs.get(value.job) : undefined;
      if (
        state &&
        this.eligible(member, value) &&
        value.scheduledAt !== undefined &&
        (state.run?.member === member ||
          state.reservation?.member === member) &&
        this.window(state, value.scheduledAt)
      )
        state.last = Math.max(state.last, value.scheduledAt);
    } else if (value.type === "jobs:claim") this.claim(member, value);
    else if (value.type === "jobs:accept") this.accept(member, value);
    else if (
      value.type === "jobs:complete" ||
      value.type === "jobs:never-started"
    ) {
      const state = value.job ? this.jobs.get(value.job) : undefined;
      if (state?.run && this.owns(state.run, member, value))
        state.run = undefined;
    } else if (value.type === "jobs:cancel") {
      const state = value.job ? this.jobs.get(value.job) : undefined;
      if (
        state?.reservation &&
        state.reservation.member === member &&
        state.reservation.requestId === value.requestId
      )
        this.clearReservation(state);
      if (
        state?.run &&
        state.run.member === member &&
        state.run.requestId === value.requestId
      )
        this.send(member, {
          type: "jobs:cancel-run",
          job: value.job,
          requestId: state.run.requestId,
          token: state.run.token,
          activationId: state.run.activationId,
        });
    }
    return true;
  }

  private eligible(member: Member, packet: JobsPacket): boolean {
    return (
      !this.closing &&
      member.active &&
      !member.draining &&
      !member.exited &&
      member.worker.isConnected() &&
      this.isCurrent(member.worker, member.slot) &&
      packet.activationId === member.activationId &&
      !!packet.requestId &&
      !!packet.job &&
      this.manifest?.mode === "ipc"
    );
  }

  private window(state: JobState, scheduledAt: number): boolean {
    const now = Date.now();
    let advanced = 0;
    while (state.next && now >= state.next.getTime() && advanced++ < 64) {
      state.due = state.next;
      state.next = nextJobTime(state.spec, state.due, state.spec.timezone);
    }
    if (state.next && now >= state.next.getTime()) {
      state.due = nextJobTime(state.spec, new Date(now), state.spec.timezone);
      state.next =
        state.due && nextJobTime(state.spec, state.due, state.spec.timezone);
      return false;
    }
    return (
      state.due?.getTime() === scheduledAt &&
      now >= scheduledAt &&
      now < (state.next?.getTime() ?? 8640000000000000)
    );
  }

  private claim(member: Member, packet: JobsPacket): void {
    const state = packet.job ? this.jobs.get(packet.job) : undefined;
    const skip = (reason: string) =>
      this.send(member, { ...packet, type: "jobs:skip", reason });
    if (
      !state ||
      !this.eligible(member, packet) ||
      packet.scheduledAt === undefined ||
      !this.window(state, packet.scheduledAt)
    ) {
      skip("ineligible-or-outside-window");
      return;
    }
    if (
      state.reservation &&
      this.owns(state.reservation, member, packet, false)
    ) {
      if (performance.now() >= state.reservation.deadline) {
        this.clearReservation(state);
        skip("reservation-expired");
        return;
      }
      this.send(member, {
        ...packet,
        type: "jobs:offer",
        token: state.reservation.token,
      });
      return;
    }
    if (state.run && this.owns(state.run, member, packet, false)) {
      this.accept(member, { ...packet, token: state.run.token });
      return;
    }
    if (packet.scheduledAt <= state.last) {
      skip("already-consumed");
      return;
    }
    state.last = packet.scheduledAt;
    if (state.run || state.reservation) {
      skip("busy");
      return;
    }
    const owner: Owner = {
      member,
      activationId: member.activationId,
      requestId: packet.requestId!,
      token: randomUUID(),
      scheduledAt: packet.scheduledAt,
      deadline:
        performance.now() +
        Math.min(
          2000,
          (state.next?.getTime() ?? 8640000000000000) - Date.now(),
        ),
    };
    const timer = setTimeout(() => {
      if (state.reservation?.token === owner.token)
        this.clearReservation(state);
    }, 2000);
    timer.unref();
    state.reservation = { ...owner, timer };
    this.send(member, { ...packet, type: "jobs:offer", token: owner.token });
  }

  private accept(member: Member, packet: JobsPacket): void {
    const state = packet.job ? this.jobs.get(packet.job) : undefined;
    if (!state) return;
    const owner = state.reservation ?? state.run;
    if (
      !owner ||
      !this.owns(owner, member, packet) ||
      !this.eligible(member, packet) ||
      performance.now() >= owner.deadline ||
      !this.window(state, owner.scheduledAt)
    ) {
      if (state.reservation && this.owns(state.reservation, member, packet))
        this.clearReservation(state);
      this.send(member, {
        ...packet,
        type: "jobs:skip",
        reason: "accept-ineligible",
      });
      return;
    }
    // No await between final eligibility and committed ownership. PERMIT loss
    // cannot turn a possibly running handler into an automatically free slot.
    state.run = owner;
    this.clearReservation(state);
    this.send(member, {
      ...packet,
      type: "jobs:permit",
      scheduledAt: owner.scheduledAt,
    });
  }

  private owns(
    owner: Owner,
    member: Member,
    packet: JobsPacket,
    token = true,
  ): boolean {
    return (
      owner.member === member &&
      owner.activationId === packet.activationId &&
      owner.requestId === packet.requestId &&
      (!token || owner.token === packet.token)
    );
  }
  private clearReservation(state: JobState): void {
    if (state.reservation) clearTimeout(state.reservation.timer);
    state.reservation = undefined;
  }
  private revokeReservations(member: Member): void {
    for (const state of this.jobs.values())
      if (state.reservation?.member === member) this.clearReservation(state);
  }
  private send(member: Member, value: Omit<JobsPacket, "version">): void {
    try {
      member.worker.send(
        {
          ...value,
          version: 1,
          epoch: this.epoch,
          generation: member.generation,
          slot: member.slot,
        },
        () => {},
      );
    } catch {
      /* Unknown delivery never clears committed ownership. */
    }
  }
  private resolveWaiter(waiter: Waiter): void {
    clearTimeout(waiter.timer);
    clearInterval(waiter.retry);
    waiter.resolve();
  }
  private rejectWaiter(waiter: Waiter | undefined, reason: string): void {
    if (!waiter) return;
    clearTimeout(waiter.timer);
    clearInterval(waiter.retry);
    waiter.reject(new Error(`[vextjs] ${reason}`));
  }
  stop(): void {
    this.closing = true;
    for (const member of this.members.values()) {
      member.active = false;
      member.draining = true;
      this.revokeReservations(member);
      this.send(member, {
        type: "jobs:stop",
        activationId: member.activationId,
        reason: "master-closing",
      });
    }
  }
  retire(worker: Worker): void {
    const member = this.members.get(worker);
    if (!member) return;
    member.active = false;
    member.draining = true;
    this.revokeReservations(member);
    this.send(member, {
      type: "jobs:stop",
      activationId: member.activationId,
      reason: "candidate-cleanup",
    });
  }
}
