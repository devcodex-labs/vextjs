/** Shared bounds for the two-phase, paused socket handoff. */
export const SOCKET_HANDOFF_POLICY = Object.freeze({
  version: 1,
  timeout: 5_000,
  maxPending: 1_024,
  maxPendingPerWorker: 64,
});

export interface SocketWorkerContext {
  version: number;
  generation: string;
  host: string;
  port: number;
}

export const SOCKET_WORKER_CONTEXT_ENV = "VEXT_SOCKET_WORKER_CONTEXT";

export const CLUSTER_WORKER_POLICY_ENV = "VEXT_CLUSTER_WORKER_POLICY";
export interface ClusterWorkerPolicy {
  sticky: "none" | "ip";
  workers: "auto" | "auto-1" | number;
}

export function parseClusterWorkerPolicy(value: string): ClusterWorkerPolicy {
  const policy = JSON.parse(value) as ClusterWorkerPolicy;
  if (
    !policy ||
    !["none", "ip"].includes(policy.sticky) ||
    !(
      policy.workers === "auto" ||
      policy.workers === "auto-1" ||
      (Number.isInteger(policy.workers) &&
        Number(policy.workers) >= 1 &&
        Number(policy.workers) <= 64)
    )
  ) {
    throw new Error("[cluster] invalid worker policy");
  }
  return policy;
}

export function parseSocketWorkerContext(value: string): SocketWorkerContext {
  const context = JSON.parse(value) as SocketWorkerContext;
  if (
    context.version !== SOCKET_HANDOFF_POLICY.version ||
    typeof context.generation !== "string" ||
    !context.generation ||
    typeof context.host !== "string" ||
    !context.host ||
    !Number.isInteger(context.port) ||
    context.port < 1 ||
    context.port > 65535
  )
    throw new Error("[cluster] invalid socket worker context");
  return context;
}
