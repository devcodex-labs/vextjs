/** HTTP/browser contract. Persistence timestamps and MongoDB internals stay on the server. */
export type BlogStatus = "draft" | "published";

export interface BlogPostDto {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  status: BlogStatus;
  featured: boolean;
  tags: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  readingMinutes: number;
}

export interface BlogListQuery {
  page?: number;
  limit?: number;
  search?: string;
  tag?: string;
  status?: BlogStatus;
}

export interface BlogPage {
  items: BlogPostDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface BlogWriteInput {
  slug?: string;
  title: string;
  excerpt: string;
  content: string;
  status?: BlogStatus;
  featured?: boolean;
  tags?: string[];
  publishedAt?: string | null;
}

export type BlogPatchInput = Partial<BlogWriteInput>;
export type CacheRefresh = "complete" | "pending";
export interface BlogSaved {
  post: BlogPostDto;
  cacheRefresh: CacheRefresh;
}
export interface BlogDeleted {
  deleted: true;
  cacheRefresh: CacheRefresh;
}
export interface BlogStats {
  total: number;
  featured: number;
  tags: string[];
}
