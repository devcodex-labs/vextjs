import path from "node:path";
import { createApp, DEFAULT_CONFIG } from "../../dist/lib/app.js";
import { createScheduledJobs } from "../../dist/lib/jobs/runtime.js";
import { defineJob } from "../../dist/lib/jobs/define-job.js";
const [rootDir, url, keyPrefix] = process.argv.slice(2);
const { app, internals } = createApp({
  ...DEFAULT_CONFIG,
  logger: { level: "silent" },
  jobs: { redis: { url, keyPrefix, leaseTtl: 1000 } },
});
const events = [];
const definition = defineJob({
  cron: "* * * * * *",
  handler(ctx) {
    events.push({
      at: ctx.scheduledAt.toISOString(),
      pid: process.pid,
      rootDir,
    });
  },
});
internals.setScheduledJobs(
  await createScheduledJobs(
    app,
    [
      {
        name: "sample",
        definition,
        sourceFile: path.join(rootDir, "jobs/sample.js"),
        sourcePath: "sample.js",
        exportName: "default",
      },
    ],
    { rootDir, timers: true },
  ),
);
process.send?.({ ready: true });
process.once("message", async () => {
  await internals.runReady();
  setTimeout(async () => {
    await internals.shutdown(undefined, { skipExit: true });
    console.log(JSON.stringify({ events, pid: process.pid, closed: true }));
    process.disconnect();
  }, 3500);
});
