import { createServer } from "node:http";
import process from "node:process";

import {
  installTargetShutdown,
  sendFailure,
  sendReady,
  waitForStart,
} from "../target-runtime.mjs";

const port = Number.parseInt(process.env.PORT ?? "0", 10);

async function start() {
  await waitForStart();
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      // Drain the same HTTP request body shape used by the load factory.
    }
    response.writeHead(201, {
      "content-type": "application/json",
      "x-request-id": String(request.headers["x-request-id"] ?? "missing"),
    });
    response.end('{"data":{"noop":true}}');
  });
  const shutdown = installTargetShutdown(
    () => new Promise((resolve) => server.close(resolve)),
  );
  server.once("error", (error) => {
    sendFailure(error);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    sendReady({
      target: "noop-measurement",
      port: typeof address === "object" && address ? address.port : port,
    });
  });
  return shutdown;
}

start().catch((error) => {
  sendFailure(error);
  console.error(error);
  process.exit(1);
});
