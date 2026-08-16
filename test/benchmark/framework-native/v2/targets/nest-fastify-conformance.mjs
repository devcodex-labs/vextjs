import process from "node:process";

import { HttpQuoteClient, RingOrderRepository } from "../application-model.mjs";
import { createNestApplication } from "../nest-app.mjs";
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
  const { application, raw } = await createNestApplication({
    repository: observeRepository(new RingOrderRepository(), observer),
    quoteClient: observeQuoteClient(
      new HttpQuoteClient({ baseUrl: process.env.BENCHMARK_EXTERNAL_URL }),
      observer,
    ),
    logStream: createObservingLogStream(observer),
  });
  const shutdown = installTargetShutdown(() => application.close());
  installConformanceIpc({ observer, shutdown });
  await application.listen({ host: "127.0.0.1", port });
  const address = raw.server.address();
  sendReady({
    target: "nest-fastify",
    port: typeof address === "object" && address ? address.port : port,
    versions: { fastify: raw.version, nest: "NestFactory+FastifyAdapter" },
  });
}

start().catch((error) => {
  sendFailure(error);
  console.error(error);
  process.exit(1);
});
