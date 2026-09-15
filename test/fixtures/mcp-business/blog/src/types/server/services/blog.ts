import type { BlogPostDocument } from "../models/blog-post.js";

/** Only editable persisted fields; query APIs and write results use native monSQLize types. */
export type BlogEditableFields = Pick<
  BlogPostDocument,
  | "slug"
  | "title"
  | "excerpt"
  | "content"
  | "status"
  | "featured"
  | "tags"
  | "publishedAt"
>;
