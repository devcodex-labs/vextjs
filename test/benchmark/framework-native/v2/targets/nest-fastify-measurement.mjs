import process from "node:process";

import { HttpQuoteClient, RingOrderRepository } from "../application-model.mjs";
import { createNestApplication } from "../nest-app.mjs";
import {
  installTargetShutdown,
  sendFailure,
  sendReady,
  waitForStart,
} from "../target-runtime.mjs";

const port = Number.parseInt(process.env.PORT ?? "0", 10);

async function start() {
  await waitForStart();
  const { application, raw } = await createNestApplication({
    repository: new RingOrderRepository(),
    quoteClient: new HttpQuoteClient({
      baseUrl: process.env.BENCHMARK_EXTERNAL_URL,
    }),
    logStream: process.stdout,
  });
  installTargetShutdown(() => application.close());
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
