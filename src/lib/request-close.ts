/**
 * Exactly-once request close hooks shared across adapters.
 *
 * Fired on:
 * - host request/response close/finish (when available)
 * - response send completion via finishResponseSend
 *
 * Token is typically the VextRequest object for the active request.
 */

const closeHandlers = new WeakMap<object, Array<() => void>>();
const closedTokens = new WeakSet<object>();

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
