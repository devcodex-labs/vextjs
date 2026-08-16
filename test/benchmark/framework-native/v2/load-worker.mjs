import autocannon from "autocannon";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { createRequest, getTimedWorkload } from "./contract.mjs";
import {
  installTargetShutdown,
  sendFailure,
  sendReady,
  waitForStart,
} from "./target-runtime.mjs";

const MAX_TRACKED_LATENCY_MS = 60_000;

class FixedLatencyHistogram {
  #bins = new Uint32Array(MAX_TRACKED_LATENCY_MS + 1);
  #count = 0;

  record(milliseconds) {
    const value = Number(milliseconds);
    if (!Number.isFinite(value) || value < 0) return;
    const bucket = Math.min(MAX_TRACKED_LATENCY_MS, Math.round(value));
    this.#bins[bucket] += 1;
    this.#count += 1;
  }

  percentile(percentileValue) {
    if (this.#count === 0) return null;
    const rank = Math.max(1, Math.ceil((percentileValue / 100) * this.#count));
    let cumulative = 0;
    for (let bucket = 0; bucket < this.#bins.length; bucket += 1) {
      cumulative += this.#bins[bucket];
      if (cumulative >= rank) return bucket;
    }
    return MAX_TRACKED_LATENCY_MS;
  }

  toJSON() {
    return {
      samples: this.#count,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
    };
  }
}

let activeInstance = null;
let stopping = false;

function normalizeStatusCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(
      ([left], [right]) => Number(left) - Number(right),
    ),
  );
}

async function runLoad(message) {
  const workload = getTimedWorkload(message.workloadId);
  const template = createRequest(
    workload,
    message.tokens,
    `${message.prefix}-template`,
  );
  const body = JSON.stringify(template.body);
  const baseHeaders = { ...template.headers };
  const latency = new FixedLatencyHistogram();
  const statusCounts = {};
  let requestSequence = 0;
  let requestErrors = 0;
  const startedAt = performance.now();
  const result = await new Promise((resolve, reject) => {
    const instance = autocannon({
      url: message.url,
      connections: message.connections,
      pipelining: message.pipelining,
      duration: message.durationSeconds,
      timeout: message.timeoutSeconds,
      requests: [
        {
          method: template.method,
          path: template.path,
          headers: baseHeaders,
          body,
          setupRequest(request) {
            const requestId = `${message.prefix}-${++requestSequence}`;
            request.headers = {
              ...baseHeaders,
              "x-request-id": requestId,
              "x-trace-id": `trace-${requestId}`,
            };
            return request;
          },
        },
      ],
    });
    activeInstance = instance;
    instance.on(
      "response",
      (_client, statusCode, _responseBytes, responseTime) => {
        statusCounts[statusCode] = (statusCounts[statusCode] ?? 0) + 1;
        latency.record(responseTime);
      },
    );
    instance.on("reqError", () => {
      requestErrors += 1;
    });
    instance.once("done", resolve);
    instance.once("error", reject);
  });
  const wallDurationSeconds = (performance.now() - startedAt) / 1_000;
  activeInstance = null;
  return {
    requestFactory: {
      mode: "autocannon-requests-setupRequest",
      generatedRequestIds: requestSequence,
      prefix: message.prefix,
    },
    autocannon: {
      durationSeconds: Number(result.duration),
      wallDurationSeconds,
      requests: result.requests,
      errors: result.errors,
      timeouts: result.timeouts,
      resets: result.resets,
      non2xx: result.non2xx,
      statusCodeStats: result.statusCodeStats,
    },
    latency: latency.toJSON(),
    statusCounts: normalizeStatusCounts(statusCounts),
    requestErrors,
  };
}

async function start() {
  await waitForStart();
  const shutdown = installTargetShutdown(async () => {
    stopping = true;
    activeInstance?.stop();
  });
  process.on("message", async (message) => {
    if (message?.type === "run") {
      if (stopping || activeInstance) {
        process.send?.({
          type: "run-error",
          requestId: message.requestId,
          message: "Load worker is unavailable",
        });
        return;
      }
      try {
        const result = await runLoad(message);
        process.send?.({ type: "run", requestId: message.requestId, result });
      } catch (error) {
        activeInstance = null;
        process.send?.({
          type: "run-error",
          requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (message?.type === "shutdown") {
      await shutdown();
    }
  });
  sendReady({ target: "autocannon-load-worker" });
}

start().catch((error) => {
  sendFailure(error);
  console.error(error);
  process.exit(1);
});
