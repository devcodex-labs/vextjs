/**
 * Exactly-once request close hooks shared across adapters.
 *
 * Fired on:
 * - premature host disconnect
 * - response send completion via finishResponseSend
 *
 * Token is typically the VextRequest object for the active request.
 */

import type { IncomingMessage } from "node:http";

const closeHandlers = new WeakMap<object, Array<() => void>>();
const closedTokens = new WeakSet<object>();

/** Keep normal body completion separate from cancellation of handler work. */
export function bindNodeRequestLifecycle(
  token: object,
  incoming: IncomingMessage,
  controller: AbortController,
): void {
  const socket = incoming.socket;
  const abort = () => {
    controller.abort(new Error("[vextjs] Request aborted"));
    fireRequestCloseHandlers(token);
  };
  const onRequestClose = () => {
    // Since Node 16, IncomingMessage 'close' also fires after a complete body.
    // The handler can still be awaiting downstream work on a live connection.
    if (!incoming.complete) abort();
  };
  incoming.once("aborted", abort);
  incoming.once("close", onRequestClose);
  socket?.once("close", abort);
  addRequestCloseHandler(token, () => {
    incoming.off("aborted", abort);
    incoming.off("close", onRequestClose);
    socket?.off("close", abort);
  });
  if (incoming.aborted || socket?.destroyed) abort();
}

/** Pure Web hosts expose cancellation through the original Request signal. */
export function bindWebRequestLifecycle(
  token: object,
  signal: AbortSignal,
  controller: AbortController,
): void {
  const abort = () => {
    controller.abort(signal.reason);
    fireRequestCloseHandlers(token);
  };
  signal.addEventListener("abort", abort, { once: true });
  addRequestCloseHandler(token, () =>
    signal.removeEventListener("abort", abort),
  );
  if (signal.aborted) abort();
}

export function addRequestCloseHandler(
  token: object,
  handler: () => void,
): void {
  if (closedTokens.has(token)) {
    // Request already completed — run immediately so late registration still works.
    try {
      handler();
    } catch {
      // ignore user handler errors
    }
    return;
  }
  let list = closeHandlers.get(token);
  if (!list) {
    list = [];
    closeHandlers.set(token, list);
  }
  list.push(handler);
}

export function fireRequestCloseHandlers(token: object): void {
  if (closedTokens.has(token)) return;
  closedTokens.add(token);
  const list = closeHandlers.get(token);
  if (!list || list.length === 0) {
    closeHandlers.delete(token);
    return;
  }
  closeHandlers.delete(token);
  for (const handler of list) {
    try {
      handler();
    } catch {
      // onClose handler 异常不应影响其他 handler
    }
  }
}
