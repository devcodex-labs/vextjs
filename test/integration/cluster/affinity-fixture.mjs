// Real ClusterMaster/workerMain and HTTP adapters, controlled through portable IPC.
import cluster from "node:cluster";
import { fileURLToPath } from "node:url";
import { ClusterMaster } from "../../../dist/lib/cluster/master.js";
import { workerMain } from "../../../dist/lib/cluster/worker.js";
import { createApp, DEFAULT_CONFIG } from "../../../dist/lib/app.js";
import { resolveAdapter } from "../../../dist/lib/adapter-resolver.js";
import { setupShutdown } from "../../../dist/lib/shutdown.js";

const adapterName = process.env.AFFINITY_ADAPTER ?? "native";
const factory = process.env.AFFINITY_FACTORY === "1";
const entry = fileURLToPath(import.meta.url);
const workerShutdownSeconds = 1;
const masterShutdownMs = 2000;

if (cluster.isWorker) {
  await workerMain(process.cwd(), async (_root, context) => {
    if (
      process.env.AFFINITY_FAIL_CANDIDATE === "1" &&
      Number(process.env.VEXT_WORKER_ID) > 2
    )
      throw new Error("candidate failure");
    const config = {
      ...DEFAULT_CONFIG,
      _testMode: false,
      logger: { ...DEFAULT_CONFIG.logger, level: "silent" },
      adapter: factory
        ? (await import(`../../../dist/adapters/${adapterName}/index.js`))[
            `${adapterName}Adapter`
          ]()
        : adapterName,
      cluster: { ...DEFAULT_CONFIG.cluster, sticky: "ip", workers: 2 },
      shutdown: { ...DEFAULT_CONFIG.shutdown, timeout: workerShutdownSeconds },
    };
    const { app, internals } = createApp(config);
    if (
      process.env.AFFINITY_SLOW_CLOSE === "1" &&
      process.env.VEXT_WORKER_ID === "1"
    ) {
      app.onClose(() => new Promise((resolve) => setTimeout(resolve, 350)));
    }
    app.adapter = await resolveAdapter(config, app, { socketHandoff: context });
    app.adapter.registerRoute("GET", "/", [
      async (request, response) => {
        const delay = Number(request.query.delay ?? 0);
        if (delay) {
          process.send?.({ type: "test-in-flight" });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        response.rawJson({
          pid: process.pid,
          generation: process.env.VEXT_WORKER_ID,
          remote: request.ip,
        });
      },
    ]);
    const serverHandle = await app.adapter.listen(context.port, context.host);
    const forceClose = serverHandle.forceClose.bind(serverHandle);
    serverHandle.forceClose = () => {
      process.send?.({
        type: "test-force-close",
        workerId: process.env.VEXT_WORKER_ID,
      });
      forceClose();
    };
    app.onClose(setupShutdown({ internals, serverHandle, logger: app.logger }));
    process.on("message", (message) => {
      if (message.type === "test-local-stop")
        void internals.shutdown(serverHandle);
    });
    return { app, internals, serverHandle };
  });
} else {
  cluster.setupPrimary({ exec: entry, execArgv: [] });
  const master = new ClusterMaster({
    workers: 2,
    sticky: "ip",
    listen: { host: "127.0.0.1", port: 0 },
    pidFile: process.env.AFFINITY_PID_FILE,
    healthCheck: { enabled: false },
    autoRestart: process.env.AFFINITY_AUTO_RESTART !== "0",
    restartBaseDelay: 20,
    restartMaxDelay: 50,
    reload: {
      workerDelay: 0,
      readyTimeout: 3000,
      shutdownTimeout: masterShutdownMs,
    },
  });
  master.on(
    "all-workers-dead",
    () => void master.gracefulShutdown("capacity loss", 1),
  );
  master.on("worker-ready", ({ workerId }) => {
    cluster.workers[workerId]?.on("message", (message) => {
      if (message.type === "test-in-flight")
        process.send?.({ type: "in-flight" });
      else if (message.type === "test-force-close") process.send?.(message);
    });
  });
  for (const event of [
    "worker-ready",
    "worker-stopping",
    "worker-exit",
    "reload-complete",
  ]) {
    master.on(event, (data) => process.send?.({ type: event, data }));
  }
  process.on("message", async (message) => {
    try {
      if (message.type === "reload") {
        await master.rollingRestart("test IPC");
        process.send?.({ type: "reloaded" });
      } else if (message.type === "crash") {
        cluster.workers[message.id]?.process.kill("SIGKILL");
      } else if (message.type === "local-stop") {
        cluster.workers[message.id]?.send({ type: "test-local-stop" });
      } else if (message.type === "disconnect-and-stop") {
        const worker = cluster.workers[message.id];
        worker.once("disconnect", () => {
          void master.gracefulShutdown("disconnected Worker IPC");
        });
        worker.process.disconnect();
      } else if (message.type === "snapshot") {
        process.send?.({
          type: "snapshot",
          workers: [...master.getWorkerMetas().values()],
          connections: master.getConnectionSnapshot(),
        });
      }
    } catch (error) {
      process.send?.({ type: "error", error: error.message });
    }
  });
  try {
    await master.start();
    process.send?.({
      type: "listening",
      endpoint: master.getListenAddress(),
      workers: [...master.getWorkerMetas().values()],
    });
  } catch (error) {
    process.send?.({ type: "error", error: error.message });
    process.exit(1);
  }
}
