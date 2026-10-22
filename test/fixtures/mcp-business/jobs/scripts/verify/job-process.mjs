import cluster from "node:cluster";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

// This fixture owns the explicit entry. Suppress bootstrap's CLI auto-entry.
delete process.env.VEXT_MODE;
const { bootstrap, ClusterMaster, workerMain } = await import("vextjs");
const testCase = await readFile(
  path.join(process.cwd(), "jobs-case.json"),
  "utf8",
)
  .then(JSON.parse)
  .catch(() => ({}));

process.env.VEXT_BUILT = "1";
process.env.NODE_ENV = "production";

// The owned consumer runs real HTTP application lifecycles, including scheduled jobs.
async function main() {
  if (process.argv[2] === "cluster" && cluster.isPrimary) {
    process.env.VEXT_WORKER_COUNT = "2";
    const master = new ClusterMaster({
      workers: 2,
      autoRestart: false,
      healthCheck: { enabled: false },
      reload: { workerDelay: 0, readyTimeout: 15000, shutdownTimeout: 5000 },
      pidFile: path.join(process.cwd(), ".jobs-test.pid"),
    });
    const owned = new Set();
    cluster.on("fork", (worker) => {
      owned.add(worker);
      void appendFile(
        path.join(process.cwd(), "jobs-owned-processes.jsonl"),
        JSON.stringify({
          pid: worker.process.pid,
          role: "worker",
          startedAt: new Date().toISOString(),
        }) + "\n",
      );
    });
    try {
      try {
        await master.start();
      } catch (error) {
        if (!testCase.expectStartupFailure) throw error;
        console.log(
          JSON.stringify({
            role: "cluster",
            status: "PASS",
            startupFailed: true,
            error: error.message,
          }),
        );
        process.exitCode = 0;
        return;
      }
      if (testCase.expectStartupFailure)
        throw new Error("startup unexpectedly succeeded");
      if (testCase.scenario) {
        await appendFile(
          testCase.eventsFile,
          JSON.stringify({
            phase: "barrier",
            at: Date.now(),
            ready: master.getReadyWorkerCount(),
          }) + "\n",
        );
        await new Promise((resolve) => setTimeout(resolve, 2100));
      } else {
        if (testCase.slow) {
          const until = Date.now() + 10000;
          while (
            !(
              await readFile(testCase.eventsFile, "utf8").catch(() => "")
            ).includes('"phase":"start"')
          ) {
            if (Date.now() > until)
              throw new Error("slow handler did not start");
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        } else await new Promise((resolve) => setTimeout(resolve, 3100));
        await master.rollingRestart();
        await new Promise((resolve) => setTimeout(resolve, 3100));
      }
      console.log(JSON.stringify({ role: "cluster", status: "PASS" }));
      await master.gracefulShutdown("Jobs consumer verification");
    } finally {
      await Promise.all(
        [...owned]
          .filter((worker) => !worker.isDead())
          .map(
            (worker) =>
              new Promise((resolve) => {
                worker.once("exit", resolve);
                worker.kill();
              }),
          ),
      );
    }
  } else if (cluster.isWorker && process.argv[2] === "cluster") {
    await workerMain(process.cwd(), bootstrap);
  } else {
    const runtime = await bootstrap(process.cwd());
    try {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    } finally {
      await runtime.internals.shutdown(runtime.serverHandle, {
        skipExit: true,
      });
      if (cluster.isWorker) cluster.worker.disconnect();
    }
  }
}
await main();
