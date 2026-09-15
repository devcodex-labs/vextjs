import type { VextApp } from "vextjs";
import type { BlogPostDocument } from "../types/server/models/blog-post.js";
import type { BlogEditableFields } from "../types/server/services/blog.js";
import type {
  BlogListQuery,
  BlogPage,
  BlogPostDto,
  BlogWriteInput,
  BlogPatchInput,
  BlogSaved,
  BlogDeleted,
  BlogStats,
  CacheRefresh,
} from "../types/shared/blog.js";
import {
  blogQuery,
  blogPostDto,
  blogSlug,
  isDuplicateBlogSlug,
} from "../utils/server/blog.js";
import { blogBusinessIssue } from "../validators/blog.js";

/** Business orchestration: native models own query execution, validation and unique constraints. */
export default class BlogService {
  constructor(private readonly app: VextApp) {}

  private get posts() {
    if (!this.app.db)
      this.app.throw(
        503,
        "blog.errors.databaseUnavailable",
        "BLOG_DATABASE_UNAVAILABLE",
      );
    return this.app.db.model<BlogPostDocument>("BlogPost");
  }

  async list(input: BlogListQuery = {}, admin = false): Promise<BlogPage> {
    const page = input.page ?? 1;
    const limit = input.limit ?? 12;
    // Numbered pages require a fresh filtered count. findPage sync totals may use an independent cache.
    const result = await this.posts.findAndCount(blogQuery(input, admin), {
      skip: (page - 1) * limit,
      limit,
      sort: admin
        ? { updatedAt: -1, createdAt: -1, _id: -1 }
        : { publishedAt: -1, createdAt: -1, _id: -1 },
      cache: 0,
    });
    return {
      items: result.data.map(blogPostDto),
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
    };
  }

  async read(slug: string, admin = false): Promise<BlogPostDto> {
    const post = await this.posts.findOne({
      slug,
      ...(admin ? {} : { status: "published" }),
    });
    if (!post)
      this.app.throw(404, "blog.errors.notFound", "BLOG_POST_NOT_FOUND");
    return blogPostDto(post);
  }

  async stats(admin = false): Promise<BlogStats> {
    const query = blogQuery({}, admin);
    const [total, featured, tags] = await Promise.all([
      this.posts.count(query),
      this.posts.count({ ...query, featured: true }),
      this.posts.distinct("tags", query),
    ]);
    if (!tags.every((tag): tag is string => typeof tag === "string"))
      throw new Error("Blog model returned an invalid tag type");
    return { total, featured, tags: tags.sort() };
  }

  async featured(): Promise<BlogPostDto[]> {
    return (
      await this.posts.find(
        { status: "published", featured: true },
        { limit: 6, sort: { publishedAt: -1, _id: -1 } },
      )
    ).map(blogPostDto);
  }

  async related(slug: string): Promise<BlogPostDto[]> {
    const post = await this.read(slug);
    return (
      await this.posts.find(
        { status: "published", slug: { $ne: slug }, tags: { $in: post.tags } },
        { limit: 4, sort: { publishedAt: -1, _id: -1 } },
      )
    ).map(blogPostDto);
  }

  async create(input: BlogWriteInput): Promise<BlogSaved> {
    const issue = blogBusinessIssue(input);
    if (issue)
      this.app.throw(
        422,
        "blog.errors.invalid",
        { field: issue },
        "BLOG_INPUT_INVALID",
      );
    const slug = input.slug ?? blogSlug(input.title);
    if (!slug)
      this.app.throw(422, "blog.errors.slugRequired", "BLOG_INPUT_INVALID");
    // Omitted status is a draft. Publishing sets its timestamp exactly once by default.
    const status = input.status ?? "draft";
    const document: BlogEditableFields = {
      slug,
      title: input.title.trim(),
      excerpt: input.excerpt.trim(),
      content: input.content.trim(),
      status,
      featured: input.featured ?? false,
      tags: [...new Set(input.tags ?? [])],
      publishedAt:
        status === "published"
          ? (input.publishedAt ?? new Date().toISOString())
          : (input.publishedAt ?? null),
    };
    try {
      await this.posts.insertOne(document);
    } catch (error) {
      if (isDuplicateBlogSlug(error))
        this.app.throw(409, "blog.errors.slugConflict", "BLOG_SLUG_CONFLICT");
      throw error;
    }
    const cacheRefresh = await this.refreshPublicCache();
    return { post: await this.read(slug, true), cacheRefresh };
  }

  async update(slug: string, input: BlogPatchInput): Promise<BlogSaved> {
    if (!Object.keys(input).length)
      this.app.throw(422, "blog.errors.emptyUpdate", "BLOG_INPUT_INVALID");
    const issue = blogBusinessIssue(input);
    if (issue)
      this.app.throw(
        422,
        "blog.errors.invalid",
        { field: issue },
        "BLOG_INPUT_INVALID",
      );
    const current = await this.read(slug, true);
    const patch = { ...input };
    if (patch.title !== undefined) patch.title = patch.title.trim();
    if (patch.excerpt !== undefined) patch.excerpt = patch.excerpt.trim();
    if (patch.content !== undefined) patch.content = patch.content.trim();
    if (patch.tags) patch.tags = [...new Set(patch.tags)];
    if (
      patch.status === "published" &&
      !current.publishedAt &&
      patch.publishedAt === undefined
    )
      patch.publishedAt = new Date().toISOString();
    try {
      const result = await this.posts.updateOne({ slug }, { $set: patch });
      if (!result.matchedCount)
        this.app.throw(404, "blog.errors.notFound", "BLOG_POST_NOT_FOUND");
    } catch (error) {
      if (isDuplicateBlogSlug(error))
        this.app.throw(409, "blog.errors.slugConflict", "BLOG_SLUG_CONFLICT");
      throw error;
    }
    const cacheRefresh = await this.refreshPublicCache();
    return { post: await this.read(patch.slug ?? slug, true), cacheRefresh };
  }

  async remove(slug: string): Promise<BlogDeleted> {
    const result = await this.posts.deleteOne({ slug });
    if (!result.deletedCount)
      this.app.throw(404, "blog.errors.notFound", "BLOG_POST_NOT_FOUND");
    return { deleted: true, cacheRefresh: await this.refreshPublicCache() };
  }

  async purge(): Promise<{ cacheRefresh: "complete" }> {
    await this.app.cache.invalidate("blog-public");
    return { cacheRefresh: "complete" };
  }

  /** DB commit is final. A failed cache refresh is visible and can be retried, never rolled back here. */
  private async refreshPublicCache(): Promise<CacheRefresh> {
    try {
      await this.purge();
      return "complete";
    } catch (error) {
      this.app.logger.warn("Blog saved; public cache refresh pending", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "pending";
    }
  }
}
