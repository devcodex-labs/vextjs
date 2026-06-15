import type { VextFrontendAdapter } from "./types.js";

export function defineFrontendAdapter<T extends VextFrontendAdapter>(
  adapter: T,
): T {
  return adapter;
}
