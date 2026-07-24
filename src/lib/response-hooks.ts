import type {
  VextResponseBeforePatch,
  VextResponseKind,
} from "../types/hooks.js";
import type { VextResponse } from "../types/response.js";
import type { VextHeaders } from "../types/headers.js";
import { isInternalHooks } from "./hooks.js";
import { cloneHeaders, mergeHeaders } from "./headers.js";

export interface ResponseSendState {
  kind: VextResponseKind;
  data?: unknown;
  status: number;
  headers: VextHeaders;
  requestId: string;
  startedAt: number;
}

type EventEmitterLike = {
  once?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => unknown;
  destroy?: (error?: Error) => unknown;
  destroyed?: boolean;
  writableEnded?: boolean;
  headersSent?: boolean;
  statusCode?: number;
  setHeader?: (name: string, value: number | string) => unknown;
  end?: (chunk?: string) => unknown;
  readableEnded?: boolean;
};

const responseCompletions = new WeakMap<VextResponse, Promise<void>>();

export function beginResponseSend(
  res: VextResponse,
  payload: {
    kind: VextResponseKind;
    data?: unknown;
    status: number;
    headers: VextHeaders;
    wrapped: boolean;
    requestId: string;
  },
): ResponseSendState {
  const startedAt = performance.now();
  const hooks = isInternalHooks(res._hooks) ? res._hooks : undefined;
  const nextHeaders = cloneHeaders(payload.headers);
  res._onBeforeSend?.(payload.kind, payload.data, payload.status, nextHeaders);

  const hookPayload = {
    ...payload,
    headers: nextHeaders,
  };
  const patch = hooks?.emitSync("response:before", hookPayload) as
    | VextResponseBeforePatch
    | undefined;

  mergeHeaders(nextHeaders, patch?.headers);

  return {
    kind: payload.kind,
    data: patch && "data" in patch ? patch.data : payload.data,
    status: patch?.status ?? payload.status,
    headers: nextHeaders,
    requestId: payload.requestId,
    startedAt,
  };
}

export function finishResponseSend(
  res: VextResponse,
  state: ResponseSendState,
): void {
  const hooks = isInternalHooks(res._hooks) ? res._hooks : undefined;
  hooks?.emitSafeSync("response:after", {
    kind: state.kind,
    status: state.status,
    headers: state.headers,
    requestId: state.requestId,
    durationMs: Math.round(performance.now() - state.startedAt),
  });
}

export function finishResponseSendAfterStreamSettlement(
  res: VextResponse,
  state: ResponseSendState,
  readable: NodeJS.ReadableStream,
  target?: EventEmitterLike,
): void {
  const completion = waitForStreamSettlement(readable, state, target).then(
    () => {
      finishResponseSend(res, state);
    },
  );
  responseCompletions.set(res, completion);
  void completion;
}

export async function waitForResponseSend(res: VextResponse): Promise<void> {
  await responseCompletions.get(res);
}

function waitForStreamSettlement(
  readable: NodeJS.ReadableStream,
  state: ResponseSendState,
  target?: EventEmitterLike,
): Promise<void> {
  const source = readable as EventEmitterLike;
  const observedTarget = target && hasOnce(target) ? target : undefined;
  const observedSource = hasOnce(source) ? source : undefined;

  return new Promise((resolve) => {
    if (!observedTarget && !observedSource) {
      queueMicrotask(resolve);
      return;
    }

    let settled = false;
    const listeners: Array<{
      emitter: EventEmitterLike;
      event: string;
      listener: (...args: unknown[]) => void;
    }> = [];

    const cleanup = () => {
      for (const item of listeners) {
        removeListener(item.emitter, item.event, item.listener);
      }
    };

    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error?: unknown) => {
      // The source error is already observed here. Closing the response target
      // with the same Error can re-emit it through an underlying socket.
      if (!writeStreamFailureResponse(observedTarget, state, error)) {
        destroyTarget(observedTarget);
      }
      settle();
    };

    const on = (
      emitter: EventEmitterLike,
      event: string,
      listener: (...args: unknown[]) => void,
    ) => {
      emitter.once?.(event, listener);
      listeners.push({ emitter, event, listener });
    };

    if (observedTarget) {
      on(observedTarget, "finish", settle);
      on(observedTarget, "close", settle);
      on(observedTarget, "error", fail);
      if (observedTarget.writableEnded || observedTarget.destroyed) {
        queueMicrotask(settle);
      }
    } else if (observedSource) {
      on(observedSource, "end", settle);
      on(observedSource, "close", settle);
      if (observedSource.readableEnded || observedSource.destroyed) {
        queueMicrotask(settle);
      }
    }

    if (observedSource) {
      on(observedSource, "error", fail);
    }
  });
}

function hasOnce(value: EventEmitterLike): boolean {
  return typeof value.once === "function";
}

function removeListener(
  emitter: EventEmitterLike,
  event: string,
  listener: (...args: unknown[]) => void,
): void {
  if (typeof emitter.off === "function") {
    emitter.off(event, listener);
    return;
  }
  emitter.removeListener?.(event, listener);
}

function destroyTarget(target: EventEmitterLike | undefined) {
  if (!target || typeof target.destroy !== "function") return;
  if (target.destroyed || target.writableEnded) return;
  target.destroy();
}

function writeStreamFailureResponse(
  target: EventEmitterLike | undefined,
  state: ResponseSendState,
  error: unknown,
): boolean {
  if (!target || typeof target.end !== "function") return false;
  if (target.headersSent || target.writableEnded || target.destroyed) {
    return false;
  }
  const body = JSON.stringify({
    code: 500,
    message:
      error instanceof Error && error.message
        ? error.message
        : "Stream response failed",
    requestId: state.requestId,
  });
  target.statusCode = 500;
  target.setHeader?.("Content-Type", "application/json; charset=utf-8");
  target.setHeader?.("Content-Length", Buffer.byteLength(body));
  target.end(body);
  return true;
}
