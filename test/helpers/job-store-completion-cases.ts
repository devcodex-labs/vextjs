import { expect } from "vitest";
import type { VextJobStatus, VextJobStore } from "../../src/lib/jobs/types.js";

// The same observable contract runs against memory, file, and real Redis stores.
// Explicit times make lease takeover deterministic without sleeping or changing the host clock.
const at = new Date("2026-09-13T00:00:00.000Z");
const claim = { ownerId: "original", now: at, leaseTtl: 1000 };

export const jobStoreCompletionCases: Array<{
  name: string;
  run(store: VextJobStore): Promise<void>;
}> = [
  {
    name: "rejects missing and unclaimed runs without changing their records",
    async run(store) {
      expect(await store.completeRun("missing", { status: "success" })).toBe(
        false,
      );
      const queued = await store.enqueueRun({
        jobName: "unclaimed",
        trigger: "enqueue",
        runAt: at,
      });
      for (const options of [undefined, {}, { ownerId: "original" }]) {
        expect(
          await store.completeRun(
            queued.id,
            { status: "success", result: "invalid" },
            options,
          ),
        ).toBe(false);
        expect(await store.getRun(queued.id)).toEqual(queued);
      }
    },
  },
  {
    name: "requires a nonempty matching owner while running",
    async run(store) {
      const queued = await store.enqueueRun({
        jobName: "owner",
        trigger: "enqueue",
        runAt: at,
      });
      const running = await store.claimRun(queued.id, claim);
      expect(running).toMatchObject({
        status: "running",
        leaseOwner: "original",
      });
      for (const options of [
        undefined,
        {},
        { ownerId: "" },
        { ownerId: "other" },
      ]) {
        expect(
          await store.completeRun(queued.id, { status: "failed" }, options),
        ).toBe(false);
        expect(await store.getRun(queued.id)).toEqual(running);
      }
      const empty = await store.enqueueRun({
        jobName: "empty-owner",
        trigger: "enqueue",
        runAt: at,
      });
      await store.claimRun(empty.id, { ...claim, ownerId: "" });
      expect(
        await store.completeRun(
          empty.id,
          { status: "success" },
          { ownerId: "" },
        ),
      ).toBe(false);
    },
  },
  {
    name: "preserves all terminal states against repeated or ownerless completion",
    async run(store) {
      const statuses: VextJobStatus[] = [
        "success",
        "failed",
        "timeout",
        "cancelled",
      ];
      for (const status of statuses) {
        const queued = await store.enqueueRun({
          jobName: status,
          trigger: "enqueue",
          runAt: at,
        });
        await store.claimRun(queued.id, claim);
        expect(
          await store.completeRun(
            queued.id,
            { status, result: { committed: true }, attempts: 2 },
            { ownerId: claim.ownerId },
          ),
        ).toBe(true);
        const completed = await store.getRun(queued.id);
        expect(completed).toMatchObject({
          status,
          result: { committed: true },
          attempts: 2,
        });
        expect(completed).not.toHaveProperty("leaseOwner");
        expect(completed).not.toHaveProperty("leaseUntil");
        for (const options of [
          undefined,
          { ownerId: claim.ownerId },
          { ownerId: "other" },
        ]) {
          expect(
            await store.completeRun(
              queued.id,
              { status: "running", result: "overwrite" },
              options,
            ),
          ).toBe(false);
          expect(await store.getRun(queued.id)).toEqual(completed);
        }
        expect(
          await store.renewRunLease(queued.id, claim.ownerId, 1000, at),
        ).toBe(false);
        expect(
          await store.claimRun(queued.id, {
            ...claim,
            now: new Date(at.getTime() + 5000),
          }),
        ).toBeUndefined();
      }
    },
  },
  {
    name: "rejects a late old owner both before and after the new owner completes",
    async run(store) {
      const queued = await store.enqueueRun({
        jobName: "takeover",
        trigger: "enqueue",
        runAt: at,
      });
      await store.claimRun(queued.id, claim);
      const takeover = {
        ownerId: "replacement",
        now: new Date(at.getTime() + 2000),
        leaseTtl: 1000,
      };
      expect(await store.claimNextRun(takeover)).toMatchObject({
        id: queued.id,
        leaseOwner: takeover.ownerId,
      });
      expect(
        await store.completeRun(
          queued.id,
          { status: "success", result: "stale" },
          { ownerId: claim.ownerId },
        ),
      ).toBe(false);
      expect(
        await store.completeRun(
          queued.id,
          { status: "success", result: "current" },
          { ownerId: takeover.ownerId },
        ),
      ).toBe(true);
      const completed = await store.getRun(queued.id);
      expect(
        await store.completeRun(
          queued.id,
          { status: "failed", result: "stale" },
          { ownerId: claim.ownerId },
        ),
      ).toBe(false);
      expect(await store.getRun(queued.id)).toEqual(completed);
      expect(completed).toMatchObject({ status: "success", result: "current" });
      expect(
        await store.claimNextRun({
          ...takeover,
          now: new Date(at.getTime() + 5000),
        }),
      ).toBeUndefined();
    },
  },
  {
    name: "accepts only one concurrent completion from the same owner",
    async run(store) {
      const queued = await store.enqueueRun({
        jobName: "concurrent",
        trigger: "enqueue",
        runAt: at,
      });
      await store.claimRun(queued.id, claim);
      const accepted = await Promise.all(
        ["first", "second"].map((result) =>
          store.completeRun(
            queued.id,
            { status: "success", result },
            { ownerId: claim.ownerId },
          ),
        ),
      );
      expect(accepted.filter(Boolean)).toHaveLength(1);
      expect(await store.getRun(queued.id)).toMatchObject({
        status: "success",
        result: accepted[0] ? "first" : "second",
      });
    },
  },
];
