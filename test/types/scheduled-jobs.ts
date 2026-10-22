import { defineJob, type VextUserConfig } from "vextjs";
import { createTestJobScheduler, type TestJobScheduler } from "vextjs/testing";

defineJob({
  cron: "* * * * *",
  leaseTtl: 1000,
  handler(ctx) {
    const time: Date = ctx.scheduledAt;
    const signal: AbortSignal = ctx.signal;
    void time;
    void signal;
    // @ts-expect-error Scheduled jobs have no queue payload.
    void ctx.payload;
    // @ts-expect-error Scheduled jobs have no retry attempt number.
    void ctx.attempt;
  },
});
defineJob({ cron: "0 9 * * *", timezone: "Asia/Shanghai", handler() {} });

// @ts-expect-error A schedule is required.
defineJob({ handler() {} });
// @ts-expect-error Cron and interval are mutually exclusive.
defineJob({ cron: "* * * * *", interval: 1000, handler() {} });
// @ts-expect-error Interval is unsupported even with a timezone.
defineJob({ interval: 1000, timezone: "UTC", handler() {} });
// @ts-expect-error Queue configuration was removed.
defineJob({ interval: 1000, queue: {}, handler() {} });

const config: VextUserConfig = {
  jobs: {
    enabled: true,
    redis: { namespace: "app:production", leaseTtl: 30000 },
  },
};
void config;
async function scheduler(): Promise<TestJobScheduler> {
  return createTestJobScheduler({
    now: new Date(0),
    jobs: { sample: defineJob({ cron: "* * * * * *", handler() {} }) },
  });
}
void scheduler;
