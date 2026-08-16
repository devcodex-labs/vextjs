import process from "node:process";

import { HttpQuoteClient, RingOrderRepository } from "../application-model.mjs";
import { createFastifyApp } from "../fastify-app.mjs";
import {
  ConformanceObserver,
  createObservingLogStream,
  observeQuoteClient,
  observeRepository,
} from "../observation.mjs";
import {
  installConformanceIpc,
  installTargetShutdown,
  sendFailure,
  sendReady,
  waitForStart,
} from "../target-runtime.mjs";

const port = Number.parseInt(process.env.PORT ?? "0", 10);

async function start() {
  await waitForStart();
  const observer = new ConformanceObserver();
  const app = await createFastifyApp({
    repository: observeRepository(new RingOrderRepository(), observer),
    quoteClient: observeQuoteClient(
      new HttpQuoteClient({ baseUrl: process.env.BENCHMARK_EXTERNAL_URL }),
      observer,
    ),
    logStream: createObservingLogStream(observer),
  });
  const shutdown = installTargetShutdown(() => app.close());
  installConformanceIpc({ observer, shutdown });
  await app.listen({ host: "127.0.0.1", port });
  const address = app.server.address();
  sendReady({
    target: "fastify",
    port: typeof address === "object" && address ? address.port : port,
    versions: { fastify: app.version },
  });
}

start().catch((error) => {
  sendFailure(error);
  console.error(error);
  process.exit(1);
});
