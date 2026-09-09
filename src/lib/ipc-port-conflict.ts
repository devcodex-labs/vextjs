import type {
  PortConflictDecision,
  PortConflictRequest,
} from "./port-conflict.js";
import { sendMessageToParent } from "./ipc-message.js";

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
      process.removeListener("disconnect", onDisconnect);
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
        const action = (message as Record<string, unknown>).action;
        resolve(
          action === "retry" || action === "kill" || action === "next"
            ? action
            : "abort",
        );
      }
    };

    const fail = (error: unknown) => {
      if (settled) return;
      cleanup();
      reject(error);
    };
    const onDisconnect = () =>
      fail(
        new Error(
          "[vextjs] IPC parent disconnected while waiting for port decision",
        ),
      );
    process.on("message", onMessage);
    process.once("disconnect", onDisconnect);
    sendMessageToParent({ type: "port-conflict", ...request }).catch(fail);
  });
}

export function sendLifecycleLevelToParent(level: "concise" | "verbose"): void {
  if (process.env.VEXT_MODE !== "start" && process.env.VEXT_MODE !== "dev") {
    return;
  }

  if (!process.send) return;
  sendMessageToParent({ type: "lifecycle-config", level }).catch((error) => {
    console.error("[vextjs] lifecycle notification failed:", error);
  });
}
