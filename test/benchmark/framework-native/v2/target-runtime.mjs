import process from "node:process";

export function sendReady(payload) {
  process.send?.({ type: "ready", ...payload, pid: process.pid });
}

export function sendFailure(error) {
  process.send?.({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}

export function waitForStart({ timeoutMs = 10_000 } = {}) {
  if (!process.send) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Benchmark target did not receive start within ${timeoutMs} ms`,
        ),
      );
    }, timeoutMs);
    const onMessage = (message) => {
      if (message?.type === "start") {
        cleanup();
        resolve();
      } else if (message?.type === "shutdown") {
        cleanup();
        process.exit(0);
      }
    };
    const onDisconnect = () => {
      cleanup();
      reject(new Error("Benchmark target parent disconnected before start"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      process.off("message", onMessage);
      process.off("disconnect", onDisconnect);
    };
    process.on("message", onMessage);
    process.once("disconnect", onDisconnect);
    process.send({ type: "awaiting-start", pid: process.pid });
  });
}

export function installTargetShutdown(close) {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await close();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.once("disconnect", shutdown);
  process.on("message", (message) => {
    if (message?.type === "shutdown") void shutdown();
  });
  return shutdown;
}

export function installConformanceIpc({ observer, shutdown }) {
  process.on("message", async (message) => {
    if (message?.type === "snapshot") {
      process.send?.({
        type: "snapshot",
        requestId: message.requestId,
        observer: observer.snapshot(),
      });
    } else if (message?.type === "reset") {
      observer.reset();
      process.send?.({ type: "reset", requestId: message.requestId });
    } else if (message?.type === "shutdown") {
      await shutdown();
    }
  });
}
