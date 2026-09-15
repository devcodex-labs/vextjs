/** Shared request and runtime response schemas; docs metadata cannot replace these contracts. */
export const blogProperties = {
  slug: {
    type: "string",
    minLength: 1,
    maxLength: 80,
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  },
  title: { type: "string", minLength: 1, maxLength: 160 },
  excerpt: { type: "string", minLength: 1, maxLength: 500 },
  content: { type: "string", minLength: 1, maxLength: 20_000 },
  status: { type: "string", enum: ["draft", "published"] },
  featured: { type: "boolean" },
  tags: {
    type: "array",
    maxItems: 10,
    items: { type: "string", minLength: 1, maxLength: 40 },
  },
  publishedAt: {
    anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
  },
} as const;

export const blogCreateSchema = {
  slug: blogProperties.slug,
  "title!": blogProperties.title,
  "excerpt!": blogProperties.excerpt,
  "content!": blogProperties.content,
  status: blogProperties.status,
  featured: blogProperties.featured,
  tags: blogProperties.tags,
  publishedAt: blogProperties.publishedAt,
} as const;
export const blogPatchSchema = blogProperties;
export const blogQuerySchema = {
  page: "integer:1-100000?",
  limit: "integer:1-100?",
  search: "string:1-120?",
  tag: "string:1-40?",
  status: { enum: ["draft", "published"] },
} as const;
export const blogSlugSchema = { "slug!": blogProperties.slug } as const;

export const blogPostSchema = {
  type: "object",
  properties: {
    ...blogProperties,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    readingMinutes: { type: "integer", minimum: 1 },
  },
  required: [
    "slug",
    "title",
    "excerpt",
    "content",
    "status",
    "featured",
    "tags",
    "publishedAt",
    "createdAt",
    "updatedAt",
    "readingMinutes",
  ],
  additionalProperties: false,
} as const;
export const blogPageSchema = {
  type: "object",
  properties: {
    items: { type: "array", items: blogPostSchema },
    page: { type: "integer" },
    limit: { type: "integer" },
    total: { type: "integer" },
    totalPages: { type: "integer" },
  },
  required: ["items", "page", "limit", "total", "totalPages"],
  additionalProperties: false,
} as const;
export const blogSavedSchema = {
  type: "object",
  properties: {
    post: blogPostSchema,
    cacheRefresh: { enum: ["complete", "pending"] },
  },
  required: ["post", "cacheRefresh"],
  additionalProperties: false,
} as const;
export const blogDeletedSchema = {
  type: "object",
  properties: {
    deleted: { const: true },
    cacheRefresh: { enum: ["complete", "pending"] },
  },
  required: ["deleted", "cacheRefresh"],
  additionalProperties: false,
} as const;
export const blogStatsSchema = {
  type: "object",
  properties: {
    total: { type: "integer" },
    featured: { type: "integer" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["total", "featured", "tags"],
  additionalProperties: false,
} as const;
const blogErrorSchema = {
  type: "object",
  properties: {
    code: { type: ["integer", "string"] },
    message: { type: "string" },
  },
  required: ["code", "message"],
  additionalProperties: true,
} as const;
export const blogErrorResponses = {
  400: { schema: blogErrorSchema },
  401: { schema: blogErrorSchema },
  404: { schema: blogErrorSchema },
  409: { schema: blogErrorSchema },
  422: { schema: blogErrorSchema },
  503: { schema: blogErrorSchema },
};
