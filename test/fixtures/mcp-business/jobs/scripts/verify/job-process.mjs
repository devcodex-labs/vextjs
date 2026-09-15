import cluster from "node:cluster";
import { bootstrapJobRuntime, startJobScheduler, startJobWorker } from "vextjs";

// Owned acceptance processes use the public headless runtime. This is not an HTTP cluster or an implicit scheduler.
const mode = process.argv[2];
if (!["worker", "scheduler", "cluster"].includes(mode))
  throw new Error("Unknown Job consumer mode");
if (mode === "cluster" && cluster.isPrimary) {
  const workers = [cluster.fork(), cluster.fork()];
  const pids = workers.map((worker) => worker.process.pid);
  try {
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            worker.once("error", reject);
            worker.once("exit", (code, signal) =>
              code === 0
                ? resolve()
                : reject(
                    new Error(
                      "Job cluster worker exited: " + code + "/" + signal,
                    ),
                  ),
            );
          }),
      ),
    );
    console.log(
      JSON.stringify({
        role: "cluster",
        pid: process.pid,
        pids,
        status: "PASS",
      }),
    );
  } finally {
    for (const worker of workers) if (!worker.isDead()) worker.kill();
  }
} else {
  const runtime = await bootstrapJobRuntime({
    rootDir: process.cwd(),
    built: true,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 700);
  try {
    if (mode === "scheduler")
      await startJobScheduler(runtime, { signal: controller.signal });
    else await startJobWorker(runtime, { signal: controller.signal });
    if (mode !== "cluster")
      console.log(
        JSON.stringify({ role: mode, pid: process.pid, status: "PASS" }),
      );
  } finally {
    clearTimeout(timer);
    await runtime.close();
    if (cluster.isWorker) cluster.worker.disconnect();
  }
}
