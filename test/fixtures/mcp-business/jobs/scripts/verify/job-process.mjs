import cluster from "node:cluster";
import { bootstrap } from "vextjs";

// The owned consumer runs real HTTP application lifecycles, including scheduled jobs.
if (process.argv[2] === "cluster" && cluster.isPrimary) {
  const workers = [cluster.fork(), cluster.fork()];
  try {
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise((resolve, reject) => {
            worker.once("error", reject);
            worker.once("exit", (code, signal) =>
              code === 0
                ? resolve()
                : reject(new Error(`Worker exited: ${code}/${signal}`)),
            );
          }),
      ),
    );
    console.log(JSON.stringify({ role: "cluster", status: "PASS" }));
  } finally {
    for (const worker of workers) if (!worker.isDead()) worker.kill();
  }
} else {
  process.env.VEXT_BUILT = "1";
  process.env.NODE_ENV = "production";
  const runtime = await bootstrap(process.cwd());
  try {
    await new Promise((resolve) => setTimeout(resolve, 1600));
  } finally {
    await runtime.internals.shutdown(runtime.serverHandle, { skipExit: true });
    if (cluster.isWorker) cluster.worker.disconnect();
  }
}
