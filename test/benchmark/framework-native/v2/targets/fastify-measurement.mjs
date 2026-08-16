import process from "node:process";

import { HttpQuoteClient, RingOrderRepository } from "../application-model.mjs";
import { createFastifyApp } from "../fastify-app.mjs";
import {
  installTargetShutdown,
  sendFailure,
  sendReady,
  waitForStart,
} from "../target-runtime.mjs";

const port = Number.parseInt(process.env.PORT ?? "0", 10);

async function start() {
  await waitForStart();
  const app = await createFastifyApp({
    repository: new RingOrderRepository(),
    quoteClient: new HttpQuoteClient({
      baseUrl: process.env.BENCHMARK_EXTERNAL_URL,
    }),
    logStream: process.stdout,
  });
  const shutdown = installTargetShutdown(() => app.close());
  await app.listen({ host: "127.0.0.1", port });
  const address = app.server.address();
  sendReady({
    target: "fastify",
    port: typeof address === "object" && address ? address.port : port,
    versions: { fastify: app.version },
  });
  return shutdown;
}

start().catch((error) => {
  sendFailure(error);
  console.error(error);
  process.exit(1);
});
