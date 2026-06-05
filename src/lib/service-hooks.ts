import type { VextInternalHooks } from "../types/hooks.js";

const WRAPPED = Symbol("vext.serviceHooksWrapped");

type ServiceObject = Record<PropertyKey, unknown>;

export function wrapServiceInstance<T>(
  hooks: VextInternalHooks,
  service: string,
  instance: T,
): T {
  if (instance === null || typeof instance !== "object") {
    return instance;
  }

  const obj = instance as ServiceObject;
  if (obj[WRAPPED]) {
    return instance;
  }

  Object.defineProperty(obj, WRAPPED, {
    value: true,
    enumerable: false,
    configurable: false,
  });

  for (const { owner, key, descriptor } of collectMethods(obj)) {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    Object.defineProperty(owner === obj ? obj : obj, key, {
      ...descriptor,
      value: function serviceHookWrapper(
        this: unknown,
        ...args: unknown[]
      ): unknown {
        if (
          !hooks.has("service:beforeCall") &&
          !hooks.has("service:afterCall") &&
          !hooks.has("service:error")
        ) {
          return original.apply(this, args);
        }

        hooks.emitSync("service:beforeCall", {
          service,
          method: String(key),
          args,
        });

        let result: unknown;
        try {
          result = original.apply(this, args);
        } catch (error) {
          hooks.emitSafeSync("service:error", {
            service,
            method: String(key),
            args,
            error,
          });
          throw error;
        }

        if (isPromiseLike(result)) {
          return result.then(
            (value) => {
              hooks.emitSafeSync("service:afterCall", {
                service,
                method: String(key),
                args,
                result: value,
              });
              return value;
            },
            (error) => {
              hooks.emitSafeSync("service:error", {
                service,
                method: String(key),
                args,
                error,
              });
              throw error;
            },
          );
        }

        hooks.emitSafeSync("service:afterCall", {
          service,
          method: String(key),
          args,
          result,
        });
        return result;
      },
    });
  }

  return instance;
}

function collectMethods(obj: ServiceObject): Array<{
  owner: object;
  key: PropertyKey;
  descriptor: PropertyDescriptor;
}> {
  const methods: Array<{
    owner: object;
    key: PropertyKey;
    descriptor: PropertyDescriptor;
  }> = [];
  const seen = new Set<PropertyKey>();
  let proto: object | null = Object.getPrototypeOf(obj);

  while (proto && proto !== Object.prototype) {
    for (const key of Reflect.ownKeys(proto)) {
      if (key === "constructor" || seen.has(key)) continue;
      seen.add(key);
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (!descriptor || typeof descriptor.value !== "function") continue;
      methods.push({ owner: proto, key, descriptor });
    }
    proto = Object.getPrototypeOf(proto);
  }

  return methods;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
