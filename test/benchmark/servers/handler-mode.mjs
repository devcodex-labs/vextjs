const configuredMode = process.env.VEXT_BENCH_HANDLER_MODE ?? "sync";

if (configuredMode !== "sync" && configuredMode !== "async") {
  throw new Error(
    `Unsupported VEXT_BENCH_HANDLER_MODE: ${configuredMode}. Expected sync or async.`,
  );
}

export const handlerMode = configuredMode;

/**
 * Makes the direct benchmark endpoint explicitly synchronous or asynchronous.
 * It deliberately does not wrap route-level middleware fixtures: those measure
 * their framework's actual middleware scheduling semantics.
 */
export function withBenchmarkHandler(handler) {
  if (handlerMode === "sync") return handler;
  return async (...args) => handler(...args);
}

/**
 * Fastify requires an async handler that calls reply.send() to return the reply
 * (or await it). This preserves Fastify's documented async control flow.
 */
export function withFastifyBenchmarkHandler(handler) {
  if (handlerMode === "sync") return handler;
  return async (request, reply) => {
    handler(request, reply);
    return reply;
  };
}
