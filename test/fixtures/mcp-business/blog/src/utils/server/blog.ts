import type { BlogPostDto, BlogListQuery } from "../../types/shared/blog.js";
import type { BlogPostDocument } from "../../types/server/models/blog-post.js";

/** Search text is a literal substring, never an arbitrary regular expression. */
export function blogQuery(
  input: BlogListQuery,
  admin: boolean,
): Record<string, unknown> {
  const query: Record<string, unknown> = admin ? {} : { status: "published" };
  if (admin && input.status) query.status = input.status;
  if (input.tag) query.tags = input.tag;
  if (input.search) {
    const literal = input.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { title: { $regex: literal, $options: "i" } },
      { excerpt: { $regex: literal, $options: "i" } },
    ];
  }
  return query;
}

/** Serialize both uncached Date values and cache-restored ISO values identically. */
export function blogPostDto(post: BlogPostDocument): BlogPostDto {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    status: post.status,
    featured: post.featured,
    tags: post.tags,
    publishedAt: post.publishedAt
      ? new Date(post.publishedAt).toISOString()
      : null,
    createdAt: new Date(post.createdAt).toISOString(),
    updatedAt: new Date(post.updatedAt).toISOString(),
    readingMinutes: Math.max(
      1,
      Math.ceil(post.content.trim().split(/\s+/u).length / 200),
    ),
  };
}

/** Convert only the native duplicate-key condition; all other database failures propagate. */
export function isDuplicateBlogSlug(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (
    "code" in error && (error.code === 11000 || error.code === "DUPLICATE_KEY")
  );
}

export function blogSlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
