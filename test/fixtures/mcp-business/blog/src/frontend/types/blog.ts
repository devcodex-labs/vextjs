import type messages from "../locales/blog/admin/en-US.json";
import type {
  BlogListQuery,
  BlogPage,
  BlogPostDto,
} from "../../types/shared/blog.js";

export type BlogMessages = Record<string, unknown> & {
  blog: { admin: typeof messages };
};
export type BlogLabels = typeof messages;
export interface BlogPageProps {
  page: BlogPage;
  query: BlogListQuery;
  locale: string;
}
export interface BlogDetailProps {
  post: BlogPostDto;
  related: BlogPostDto[];
  locale: string;
}
