import type { VextApp } from "../../types/app.js";
import type { AppSchemaRuntime } from "../schema-adapter.js";
import {
  requestContext,
  type RequestContextStore,
} from "../request-context.js";

// ESM/CJS 及同进程多份框架共享身份表；实际数据仍由 app 对象隔离并随其回收。
const stateKey = Symbol.for("vextjs.appSchemaRuntime.v1");
type RuntimeState = {
  runtimes: WeakMap<VextApp, AppSchemaRuntime>;
  requestOwners: WeakMap<RequestContextStore, VextApp>;
};
const globalState = globalThis as typeof globalThis & {
  [stateKey]?: RuntimeState;
};
const { runtimes, requestOwners } = (globalState[stateKey] ??= {
  runtimes: new WeakMap(),
  requestOwners: new WeakMap(),
});

export function bindAppSchemaRuntime(
  app: VextApp,
  runtime: AppSchemaRuntime,
): void {
  runtimes.set(app, runtime);
}
export function getAppSchemaRuntime(app: VextApp): AppSchemaRuntime {
  const runtime = runtimes.get(app);
  if (!runtime)
    throw new Error("[vextjs] App schema runtime was not initialized.");
  return runtime;
}
export function bindRequestLocaleOwner(app: VextApp): void {
  const store = requestContext.getStore();
  if (store) requestOwners.set(store, app);
}
export function appRequestLocale(app: VextApp): string | undefined {
  const store = requestContext.getStore();
  if (!store) return undefined;
  const owner = requestOwners.get(store);
  return owner === undefined || owner === app ? store.locale : undefined;
}
