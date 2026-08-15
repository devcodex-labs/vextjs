import { readFileSync } from "node:fs";
import process from "node:process";

const COUNTER_NAMES = Object.freeze([
  "requestId",
  "requestContext",
  "authentication",
  "authorization",
  "validation",
  "controller",
  "service",
  "externalHttp",
  "repositoryWrite",
  "structuredLog",
  "errorHandler",
]);

function counters() {
  return Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0]));
}

function cpuUsage() {
  const usage = process.cpuUsage();
  return { user: usage.user, system: usage.system };
}

/**
 * Test-only observation shell. It deliberately does not authenticate, parse,
 * validate, or construct business responses; each target owns those paths.
 * BENCHMARK_TELEMETRY=off removes per-request test counters from timed runs.
 */
export function createBenchmarkRuntime(targetId) {
  const telemetryEnabled = process.env.BENCHMARK_TELEMETRY === "on";
  const state = {
    targetId,
    telemetryEnabled,
    counters: counters(),
    repository: { writes: 0, nextId: 1 },
    resource: {
      peakRss: process.memoryUsage().rss,
      baselineCpu: cpuUsage(),
      baselineAt: new Date().toISOString(),
    },
  };
  const sampler = setInterval(() => {
    state.resource.peakRss = Math.max(
      state.resource.peakRss,
      process.memoryUsage().rss,
    );
  }, 100);
  sampler.unref?.();

  return {
    state,
    record(name, amount = 1) {
      if (!COUNTER_NAMES.includes(name)) {
        throw new Error(`Unknown framework-native benchmark counter: ${name}`);
      }
      if (telemetryEnabled) state.counters[name] += amount;
    },
    allocateOrderId() {
      const id = `order-${state.repository.nextId}`;
      state.repository.nextId += 1;
      state.repository.writes += 1;
      this.record("repositoryWrite");
      return id;
    },
    reset() {
      state.counters = counters();
      state.repository = { writes: 0, nextId: 1 };
      state.resource = {
        peakRss: process.memoryUsage().rss,
        baselineCpu: cpuUsage(),
        baselineAt: new Date().toISOString(),
      };
      return this.snapshot();
    },
    snapshot() {
      const currentCpu = cpuUsage();
      const memory = process.memoryUsage();
      return {
        targetId,
        telemetryEnabled,
        counters: { ...state.counters },
        repository: { ...state.repository },
        resource: {
          cpuMicroseconds: {
            user: currentCpu.user - state.resource.baselineCpu.user,
            system: currentCpu.system - state.resource.baselineCpu.system,
          },
          rss: memory.rss,
          peakRss: Math.max(state.resource.peakRss, memory.rss),
          heapUsed: memory.heapUsed,
          samplerIntervalMs: 100,
        },
      };
    },
    close() {
      clearInterval(sampler);
    },
  };
}

export function createDiscardLogStream(runtime) {
  return {
    write() {
      runtime.record("structuredLog");
      return true;
    },
  };
}

export function installOwnedProcessShutdown(close, runtime) {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await close();
    } finally {
      runtime.close();
      process.exit(0);
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.once("disconnect", shutdown);
}

export function readEffectiveCpuSet() {
  if (process.platform !== "linux") return "unavailable";
  try {
    return (
      /^Cpus_allowed_list:\s*(.+)$/mu
        .exec(readFileSync("/proc/self/status", "utf8"))?.[1]
        ?.trim() ?? "unavailable"
    );
  } catch {
    return "unavailable";
  }
}
