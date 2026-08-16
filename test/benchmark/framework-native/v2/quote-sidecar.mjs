import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import process from "node:process";

import {
  installTargetShutdown,
  sendFailure,
  sendReady,
  waitForStart,
} from "./target-runtime.mjs";

const port = Number.parseInt(process.env.PORT ?? "0", 10);
const nominalDelayMs = Number.parseInt(
  process.env.BENCHMARK_QUOTE_DELAY_MS ?? "0",
  10,
);
const delaySamples = [];

function bounds(values) {
  if (values.length === 0) return { min: null, max: null };
  let min = values[0];
  let max = values[0];
  for (let index = 1; index < values.length; index += 1) {
    min = Math.min(min, values[index]);
    max = Math.max(max, values[index]);
  }
  return {
    min: Number(min.toFixed(3)),
    max: Number(max.toFixed(3)),
  };
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(
    0,
    Math.min(
      sorted.length - 1,
      Math.ceil((percentileValue / 100) * sorted.length) - 1,
    ),
  );
  return Number(sorted[rank].toFixed(3));
}

function snapshot() {
  const { min, max } = bounds(delaySamples);
  return {
    nominalDelayMs,
    samples: delaySamples.length,
    actualDelayMs: {
      p50: percentile(delaySamples, 50),
      p95: percentile(delaySamples, 95),
      p99: percentile(delaySamples, 99),
      min,
      max,
    },
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
    : {};
}

function respond(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/quote") {
    respond(response, 404, { error: "not-found" });
    return;
  }
  try {
    const body = await readBody(request);
    const startedAt = performance.now();
    if (nominalDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, nominalDelayMs));
    }
    delaySamples.push(performance.now() - startedAt);
    respond(response, 200, {
      quote: {
        discountBasisPoints: 500,
        version: "quote-v2",
        sku: body.sku,
      },
    });
  } catch (error) {
    respond(response, 500, { error: String(error) });
  }
});

const shutdown = installTargetShutdown(
  () => new Promise((resolve) => server.close(resolve)),
);

process.on("message", async (message) => {
  if (message?.type === "snapshot") {
    process.send?.({
      type: "snapshot",
      requestId: message.requestId,
      sidecar: snapshot(),
    });
  } else if (message?.type === "shutdown") {
    await shutdown();
  }
});

server.on("error", (error) => {
  sendFailure(error);
  console.error(error);
  process.exit(1);
});

async function start() {
  if (!Number.isInteger(nominalDelayMs) || nominalDelayMs < 0) {
    throw new Error("BENCHMARK_QUOTE_DELAY_MS must be a non-negative integer");
  }
  await waitForStart();
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    sendReady({
      target: "quote-sidecar",
      port: typeof address === "object" && address ? address.port : port,
      nominalDelayMs,
    });
  });
}

start().catch((error) => {
  sendFailure(error);
  console.error(error);
  process.exit(1);
});
