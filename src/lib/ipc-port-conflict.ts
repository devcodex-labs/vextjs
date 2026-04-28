import type {
  PortConflictDecision,
  PortConflictRequest,
} from "./port-conflict.js";

export async function requestPortConflictDecisionFromParent(
  request: PortConflictRequest,
  timeoutMs = 30_000,
): Promise<PortConflictDecision> {
  if (!process.send) {
    throw new Error(
      `[vextjs] Port ${request.port} is already in use and no IPC parent is available for prompt mode.`,
    );
  }

  return new Promise<PortConflictDecision>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      process.removeListener("message", onMessage);
    };

    const timer = setTimeout(() => {
      if (!settled) {
        cleanup();
        reject(
          new Error(
            `[vextjs] Timed out waiting for port conflict decision on ${request.port}.`,
          ),
        );
      }
    }, timeoutMs);

    const onMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as Record<string, unknown>).type === "port-conflict-decision"
      ) {
        cleanup();
        const action = (message as Record<string, unknown>)
          .action as PortConflictDecision | undefined;
        resolve(action ?? "abort");
      }
    };

    process.on("message", onMessage);
    process.send?.({ type: "port-conflict", ...request });
  });
}

export function sendLifecycleLevelToParent(level: "concise" | "verbose"): void {
  if (process.env.VEXT_MODE !== "start" && process.env.VEXT_MODE !== "dev") {
    return;
  }

  process.send?.({ type: "lifecycle-config", level });
}

