import type {
  VextHookHandler,
  VextHookName,
  VextHookPayloadMap,
  VextHookReturn,
  VextInternalHooks,
} from "../types/hooks.js";
import type { VextLogger } from "../types/app.js";

type AnyHookHandler = (payload: unknown) => unknown | Promise<unknown>;
const EMPTY_HANDLERS: AnyHookHandler[] = [];

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function isInternalHooks(value: unknown): value is VextInternalHooks {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { emit?: unknown }).emit === "function" &&
    typeof (value as { emitSync?: unknown }).emitSync === "function"
  );
}

/**
 * Creates the framework hook manager.
 *
 * `emit` propagates handler errors. `emitSafe` logs and continues.
 * `emitSync` is used by response/service hooks and rejects async handlers so
 * those call sites keep their existing synchronous return contracts.
 */
export function createHookManager(logger?: VextLogger): VextInternalHooks {
  const listeners = new Map<VextHookName, Set<AnyHookHandler>>();

  function logHookError(name: VextHookName, error: unknown): void {
    try {
      const err = error instanceof Error ? error : new Error(String(error));
      logger?.error({ err, hook: name }, `[vextjs] hook "${name}" failed`);
    } catch {
      // Hook logging must never become a second failure path.
    }
  }

  function getHandlers(name: VextHookName): AnyHookHandler[] {
    const handlers = listeners.get(name);
    return handlers?.size ? Array.from(handlers) : EMPTY_HANDLERS;
  }

  return {
    on<K extends VextHookName>(
      name: K,
      handler: VextHookHandler<K>,
    ): () => void {
      const set = listeners.get(name) ?? new Set<AnyHookHandler>();
      set.add(handler as AnyHookHandler);
      listeners.set(name, set);

      return () => {
        set.delete(handler as AnyHookHandler);
        if (set.size === 0) {
          listeners.delete(name);
        }
      };
    },

    has(name: VextHookName): boolean {
      return (listeners.get(name)?.size ?? 0) > 0;
    },

    async emit<K extends VextHookName>(
      name: K,
      payload: VextHookPayloadMap[K],
    ): Promise<VextHookReturn<K> | undefined> {
      let result: unknown;
      for (const handler of getHandlers(name)) {
        const value = await handler(payload);
        if (value !== undefined) {
          result = value;
        }
      }
      return result as VextHookReturn<K> | undefined;
    },

    async emitSafe<K extends VextHookName>(
      name: K,
      payload: VextHookPayloadMap[K],
    ): Promise<VextHookReturn<K> | undefined> {
      let result: unknown;
      for (const handler of getHandlers(name)) {
        try {
          const value = await handler(payload);
          if (value !== undefined) {
            result = value;
          }
        } catch (error) {
          logHookError(name, error);
        }
      }
      return result as VextHookReturn<K> | undefined;
    },

    emitSync<K extends VextHookName>(
      name: K,
      payload: VextHookPayloadMap[K],
    ): VextHookReturn<K> | undefined {
      let result: unknown;
      for (const handler of getHandlers(name)) {
        const value = handler(payload);
        if (isPromiseLike(value)) {
          throw new Error(
            `[vextjs] hook "${name}" must be synchronous at this lifecycle point.`,
          );
        }
        if (value !== undefined) {
          result = value;
        }
      }
      return result as VextHookReturn<K> | undefined;
    },

    emitSafeSync<K extends VextHookName>(
      name: K,
      payload: VextHookPayloadMap[K],
    ): VextHookReturn<K> | undefined {
      let result: unknown;
      for (const handler of getHandlers(name)) {
        try {
          const value = handler(payload);
          if (isPromiseLike(value)) {
            throw new Error(
              `[vextjs] hook "${name}" must be synchronous at this lifecycle point.`,
            );
          }
          if (value !== undefined) {
            result = value;
          }
        } catch (error) {
          logHookError(name, error);
        }
      }
      return result as VextHookReturn<K> | undefined;
    },
  };
}
