import { readFileSync } from "node:fs";
import process from "node:process";
import {
  ENTERPRISE_SECURITY_HEADERS,
  createOrderResponse,
} from "./contract.mjs";

const COUNTER_NAMES = Object.freeze([
  "requestId",
  "tenantContext",
  "traceContext",
  "authentication",
  "authorization",
  "validation",
  "service",
  "repositoryRead",
  "repositoryWrite",
  "controller",
  "structuredLog",
  "errorHandler",
]);

function createCounters() {
  return Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0]));
}

function copyCpuUsage(cpuUsage) {
  return { user: cpuUsage.user, system: cpuUsage.system };
}

/**
 * Returns the kernel-reported effective CPU affinity. Formal runs use this
 * child-side evidence instead of assuming that a taskset invocation succeeded.
 */
export function readEffectiveCpuSet() {
  if (process.platform !== "linux") return "unavailable";
  try {
    const status = readFileSync("/proc/self/status", "utf8");
    return (
      /^Cpus_allowed_list:\s*(.+)$/mu.exec(status)?.[1]?.trim() ?? "unavailable"
    );
  } catch {
    return "unavailable";
  }
}

export function createEnterpriseState(targetId) {
  const state = {
    targetId,
    startedAt: new Date().toISOString(),
    counters: createCounters(),
    repository: { nextId: 1, writes: 0 },
    resource: {
      peakRss: process.memoryUsage().rss,
      resetCpu: copyCpuUsage(process.cpuUsage()),
      resetAt: new Date().toISOString(),
    },
    sampler: undefined,
  };
  startResourceSampler(state);
  return state;
}

export function increment(state, name, amount = 1) {
  if (!(name in state.counters)) {
    throw new Error(`Unknown enterprise telemetry counter: ${name}`);
  }
  state.counters[name] += amount;
}

export function resetEnterpriseState(state) {
  state.counters = createCounters();
  state.repository = { nextId: 1, writes: 0 };
  state.resource = {
    peakRss: process.memoryUsage().rss,
    resetCpu: copyCpuUsage(process.cpuUsage()),
    resetAt: new Date().toISOString(),
  };
  return snapshotEnterpriseState(state);
}

export function snapshotEnterpriseState(state) {
  const currentCpu = process.cpuUsage();
  const memory = process.memoryUsage();
  const cpu = {
    user: currentCpu.user - state.resource.resetCpu.user,
    system: currentCpu.system - state.resource.resetCpu.system,
  };
  return {
    targetId: state.targetId,
    startedAt: state.startedAt,
    resetAt: state.resource.resetAt,
    counters: { ...state.counters },
    repository: { ...state.repository },
    resource: {
      cpuMicroseconds: cpu,
      rss: memory.rss,
      peakRss: Math.max(state.resource.peakRss, memory.rss),
      heapUsed: memory.heapUsed,
    },
  };
}

export function startResourceSampler(state, intervalMs = 100) {
  if (state.sampler) return;
  state.sampler = setInterval(() => {
    state.resource.peakRss = Math.max(
      state.resource.peakRss,
      process.memoryUsage().rss,
    );
  }, intervalMs);
  state.sampler.unref?.();
}

export function stopResourceSampler(state) {
  if (state.sampler) {
    clearInterval(state.sampler);
    state.sampler = undefined;
  }
}

export function createRequestContext(state, headers = {}) {
  const requestId = String(
    headers["x-request-id"] ?? `enterprise-${state.repository.nextId}`,
  );
  increment(state, "requestId");
  return { requestId };
}

export function attachTenantContext(state, context, headers = {}) {
  const tenantId = String(headers["x-tenant-id"] ?? "benchmark-tenant");
  increment(state, "tenantContext");
  context.tenantId = tenantId;
  return context;
}

export function attachTraceContext(state, context, headers = {}) {
  const traceId = String(headers["x-trace-id"] ?? `trace-${context.requestId}`);
  increment(state, "traceContext");
  context.traceId = traceId;
  return context;
}

export function createEnterpriseContext(state, headers = {}) {
  const context = createRequestContext(state, headers);
  attachTenantContext(state, context, headers);
  attachTraceContext(state, context, headers);
  return context;
}

export function applyEnterpriseSecurityHeaders(setHeader) {
  for (const [name, value] of Object.entries(ENTERPRISE_SECURITY_HEADERS)) {
    setHeader(name, value);
  }
}

export function createRepositoryOrder({ state, userId, body, context }) {
  increment(state, "repositoryRead");
  const id = `order-${state.repository.nextId}`;
  state.repository.nextId += 1;
  state.repository.writes += 1;
  increment(state, "repositoryWrite");
  return createOrderResponse({ id, userId, body, context });
}

export function installChildShutdown({ close, state }) {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await close();
    } finally {
      stopResourceSampler(state);
      process.exit(0);
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.once("disconnect", shutdown);
}
