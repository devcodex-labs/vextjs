import { VextApiError } from "vextjs/frontend";

/** HTTP DTOs are checked by the shared runtime response contracts and consumer tests. No persistence types enter this module. */
export async function blogRequest<T>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok)
    throw new VextApiError({
      status: response.status,
      message: payload.message ?? response.statusText,
      code: payload.code,
      rawBody: payload,
      response,
    });
  return payload.data as T;
}

/** Tokens stay in component memory. Logout also removes the previous demo's persisted key. */
export function clearBlogTokenStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("vext-blog-admin-token");
  } catch {
    /* Storage may be disabled; in-memory logout still completes. */
  }
  try {
    window.sessionStorage.removeItem("vext-blog-admin-token");
  } catch {
    /* Same policy for legacy session storage. */
  }
}
