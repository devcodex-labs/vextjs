import type { BlogPatchInput } from "../types/shared/blog.js";

/** JSON body types must be checked before the framework's deliberate request coercion. */
export function blogJsonTypeIssue(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body";
  const data = body as Record<string, unknown>;
  const allowed = new Set([
    "slug",
    "title",
    "excerpt",
    "content",
    "status",
    "featured",
    "tags",
    "publishedAt",
  ]);
  for (const field of Object.keys(data)) if (!allowed.has(field)) return field;
  const strings = ["slug", "title", "excerpt", "content", "status"];
  for (const field of strings)
    if (field in data && typeof data[field] !== "string") return field;
  if ("featured" in data && typeof data.featured !== "boolean")
    return "featured";
  if (
    "tags" in data &&
    (!Array.isArray(data.tags) ||
      data.tags.some((tag) => typeof tag !== "string"))
  )
    return "tags";
  if (
    "publishedAt" in data &&
    data.publishedAt !== null &&
    typeof data.publishedAt !== "string"
  )
    return "publishedAt";
  return null;
}

export function blogBusinessIssue(input: BlogPatchInput): string | null {
  for (const field of ["title", "excerpt", "content"] as const) {
    if (typeof input[field] === "string" && !input[field].trim()) return field;
  }
  if (input.publishedAt && !Number.isFinite(Date.parse(input.publishedAt)))
    return "publishedAt";
  return null;
}
