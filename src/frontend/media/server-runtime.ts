import { AsyncLocalStorage } from "node:async_hooks";
import type { VextFrontendMediaManifest } from "./types.js";

const VEXT_MEDIA_CONTEXT_KEY = "__VEXT_MEDIA_CONTEXT__";
const storage = new AsyncLocalStorage<VextFrontendMediaManifest | undefined>();

const host = globalThis as typeof globalThis & {
  [VEXT_MEDIA_CONTEXT_KEY]?: () => VextFrontendMediaManifest | undefined;
};

host[VEXT_MEDIA_CONTEXT_KEY] ??= () => storage.getStore();

export function withVextMediaManifest<T>(
  manifest: VextFrontendMediaManifest | undefined,
  callback: () => T,
): T {
  return storage.run(manifest, callback);
}
