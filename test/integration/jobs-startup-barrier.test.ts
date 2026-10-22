import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBusinessConsumer,
  repository,
} from "../helpers/mcp-business-consumer.js";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
describe("Jobs real bootstrap readiness barrier", () => {
  it.each([
    { mode: "ipc", scenario: "delay" },
    { mode: "redis", scenario: "delay" },
    { mode: "ipc", scenario: "first-fail" },
    { mode: "redis", scenario: "first-fail" },
    { mode: "ipc", scenario: "later-fail" },
    { mode: "ipc", scenario: "mismatch" },
  ])(
    "keeps $mode startup faithful to $scenario",
    async ({ mode, scenario }) => {
      const consumer = await createBusinessConsumer({
        name: `barrier-${randomUUID().replaceAll("-", "")}`,
      });
      const eventsFile = path.join(consumer.parent, "events.jsonl");
      const port = await freePort();
      const expectFailure =
        scenario === "first-fail" || scenario === "mismatch";
      const sourceCase = JSON.stringify(scenario);
      const putSource = (file: string, source: string, reason: string) =>
        consumer.put(
          file,
          source.replaceAll(sourceCase, `String(${sourceCase})`),
          reason,
        );
      try {
        await consumer.put(
          "src/config/default.ts",
          `export default ${JSON.stringify({ host: "127.0.0.1", port, logger: { level: "silent" }, frontend: { enabled: false }, openapi: { enabled: false }, cluster: { enabled: true, workers: 2, autoRestart: false }, jobs: mode === "redis" ? { redis: { url: process.env.VEXT_TEST_REDIS_URL ?? "redis://127.0.0.1:6379", namespace: `barrier-${randomUUID()}`, leaseTtl: 1000 } } : {} })};`,
          "Real Cluster barrier fixture",
        );
        await putSource(
          "src/plugins/ready.ts",
          `import {definePlugin} from "vextjs";import {appendFile} from "node:fs/promises";export default definePlugin({name:"ready-proof",setup(app){app.onClose(()=>appendFile(${JSON.stringify(eventsFile)},JSON.stringify({phase:"closed",worker:process.env.VEXT_WORKER_ID,at:Date.now()})+"\\n"));app.onReady(async()=>{const worker=process.env.VEXT_WORKER_ID;if(${JSON.stringify(scenario)}==="delay"&&worker==="2")await new Promise(resolve=>setTimeout(resolve,2200));if((${JSON.stringify(scenario)}==="first-fail"&&worker==="1")||(${JSON.stringify(scenario)}==="later-fail"&&worker==="2"))throw new Error("necessary ready failure");await appendFile(${JSON.stringify(eventsFile)},JSON.stringify({phase:"appReady",worker,at:Date.now()})+"\\n");});}});`,
          "Necessary onReady and cleanup oracle",
        );
        await putSource(
          "src/jobs/task.ts",
          `import {defineJob} from "vextjs";import {appendFile} from "node:fs/promises";export default defineJob({cron:${JSON.stringify(scenario)}==="mismatch"&&process.env.VEXT_WORKER_ID==="2"?"*/2 * * * * *":"* * * * * *",handler(){return appendFile(${JSON.stringify(eventsFile)},JSON.stringify({phase:"handler",worker:process.env.VEXT_WORKER_ID,at:Date.now()})+"\\n");}});`,
          "One finite SDK declaration with runtime field",
        );
        await consumer.put(
          "jobs-case.json",
          JSON.stringify({
            scenario,
            eventsFile,
            expectStartupFailure: expectFailure,
          }),
          "Process test intent",
        );
        await consumer.overlayFixture("jobs");
        await consumer.command([
          path.join(repository, "dist/cli/index.js"),
          "build",
          "--typecheck",
        ]);
        const result = await consumer.command([
          "scripts/verify/job-process.mjs",
          "cluster",
        ]);
        expect(result.stdout).toContain('"status":"PASS"');
        const events = (await readFile(eventsFile, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const handlers = events.filter((event) => event.phase === "handler");
        if (expectFailure) {
          expect(handlers).toHaveLength(0);
          expect(events.some((event) => event.phase === "closed")).toBe(true);
        } else {
          const barrier = events.find((event) => event.phase === "barrier");
          expect(barrier.ready).toBe(scenario === "later-fail" ? 1 : 2);
          expect(handlers.length).toBeGreaterThanOrEqual(1);
          const lastReady = Math.max(
            ...events
              .filter((event) => event.phase === "appReady")
              .map((event) => event.at),
          );
          expect(handlers.every((event) => event.at >= lastReady)).toBe(true);
        }
        const owned = (
          await readFile(
            path.join(consumer.root, "jobs-owned-processes.jsonl"),
            "utf8",
          )
        )
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        for (const value of owned)
          expect(() => process.kill(value.pid, 0)).toThrow();
        if (process.env.VEXT_JOBS_EVIDENCE_DIR)
          await writeFile(
            path.join(
              process.env.VEXT_JOBS_EVIDENCE_DIR,
              `startup-${mode}-${scenario}.json`,
            ),
            JSON.stringify(
              {
                mode,
                scenario,
                events,
                owned,
                port,
                stdout: result.stdout,
                stderr: result.stderr,
                workersExited: true,
              },
              null,
              2,
            ),
          );
      } finally {
        await consumer.close();
      }
    },
    90000,
  );
});
