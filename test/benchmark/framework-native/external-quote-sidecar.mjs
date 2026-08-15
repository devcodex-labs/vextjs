import { createServer } from "node:http";
import process from "node:process";

const port = Number.parseInt(process.env.PORT ?? "0", 10);
const state = { quoteRequests: 0 };

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/benchmark/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ status: "ok", service: "framework-native-quote" }),
    );
    return;
  }
  if (request.method === "POST" && request.url === "/benchmark/reset") {
    state.quoteRequests = 0;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.method === "GET" && request.url === "/benchmark/stats") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ...state }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/quote") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not-found" }));
    return;
  }
  const requestId = request.headers["x-request-id"];
  const tenantId = request.headers["x-tenant-id"];
  const traceId = request.headers["x-trace-id"];
  if (!requestId || !tenantId || !traceId) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "missing-correlation" }));
    return;
  }
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 32_768) request.destroy();
  });
  request.on("end", () => {
    state.quoteRequests += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        quote: { discountBasisPoints: 500, version: "quote-v1" },
        correlation: { requestId, tenantId, traceId },
      }),
    );
  });
});

server.listen({ host: "127.0.0.1", port }, () => {
  const address = server.address();
  process.send?.({
    type: "ready",
    port: typeof address === "object" && address ? address.port : port,
  });
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
process.once("disconnect", shutdown);
