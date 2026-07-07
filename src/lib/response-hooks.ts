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
  const patch = hooks?.emitSync("response:before", payload) as
    | VextResponseBeforePatch
    | undefined;

  const nextHeaders = cloneHeaders(payload.headers);
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
