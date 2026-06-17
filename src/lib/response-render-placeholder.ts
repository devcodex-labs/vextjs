import type {
  VextRenderErrorOptions,
  VextRenderOptions,
} from "../types/response.js";

function createUnavailableError(method: "render" | "renderError"): Error {
  return new Error(
    `[vextjs] res.${method}() requires the frontend renderer runtime. ` +
      "B1.1 exposes the public response contract; B1.3 will bind the HTML renderer to adapters.",
  );
}

export function renderUnavailable(
  _page: string,
  _props?: Record<string, unknown>,
  _options?: VextRenderOptions,
): never {
  throw createUnavailableError("render");
}

export function renderErrorUnavailable(
  _errorOrStatus?: Error | number | string,
  _pageOrOptions?:
    | string
    | Record<string, unknown>
    | unknown[]
    | VextRenderErrorOptions,
  _options?: VextRenderErrorOptions,
): never {
  throw createUnavailableError("renderError");
}
