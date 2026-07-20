export const VEXT_HANDLER_DONE = Symbol.for("vextjs.handlerDone");

export interface VextHandlerCompletionTarget {
  [VEXT_HANDLER_DONE]?: Promise<void>;
}

export function markHandlerDone(
  target: object,
  completion: Promise<unknown>,
): void {
  (target as VextHandlerCompletionTarget)[VEXT_HANDLER_DONE] = completion.then(
    () => undefined,
    () => undefined,
  );
}

export function getHandlerDone(target: object): Promise<void> | undefined {
  return (target as VextHandlerCompletionTarget)[VEXT_HANDLER_DONE];
}
