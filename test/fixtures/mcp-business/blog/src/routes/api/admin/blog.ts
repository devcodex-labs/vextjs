import { defineRoutes } from "vextjs";
import {
  blogQuerySchema,
  blogSlugSchema,
  blogCreateSchema,
  blogPatchSchema,
  blogPageSchema,
  blogPostSchema,
  blogSavedSchema,
  blogDeletedSchema,
  blogStatsSchema,
  blogErrorResponses,
} from "../../../schemas/blog.js";

/** Authentication and no shared cache are mandatory on every admin operation. */
const admin = { middlewares: ["blog-auth"], cache: false as const };
export default defineRoutes((app) => {
  app.get(
    "/",
    {
      ...admin,
      validate: { query: blogQuerySchema },
      responses: { ...blogErrorResponses, 200: { schema: blogPageSchema } },
      docs: { summary: "List managed posts" },
    },
    async (req, res) => {
      res.json(await app.services.blog.list(req.valid("query"), true));
    },
  );
  app.get(
    "/stats",
    {
      ...admin,
      responses: { ...blogErrorResponses, 200: { schema: blogStatsSchema } },
      docs: { summary: "Managed blog statistics" },
    },
    async (_req, res) => {
      res.json(await app.services.blog.stats(true));
    },
  );
  app.post(
    "/purge",
    {
      ...admin,
      responses: {
        ...blogErrorResponses,
        200: { schema: { cacheRefresh: "enum:complete!" } },
      },
      docs: { summary: "Retry public cache refresh" },
    },
    async (_req, res) => {
      res.json(await app.services.blog.purge());
    },
  );
  app.get(
    "/:slug",
    {
      ...admin,
      validate: { param: blogSlugSchema },
      responses: { ...blogErrorResponses, 200: { schema: blogPostSchema } },
      docs: { summary: "Read a managed post" },
    },
    async (req, res) => {
      res.json(await app.services.blog.read(req.valid("param").slug, true));
    },
  );
  app.post(
    "/",
    {
      ...admin,
      middlewares: ["blog-auth", "blog-json"],
      validate: { body: blogCreateSchema },
      responses: { ...blogErrorResponses, 201: { schema: blogSavedSchema } },
      docs: { summary: "Create a draft unless explicitly published" },
    },
    async (req, res) => {
      res.json(await app.services.blog.create(req.valid("body")), 201);
    },
  );
  app.patch(
    "/:slug",
    {
      ...admin,
      middlewares: ["blog-auth", "blog-json"],
      validate: { param: blogSlugSchema, body: blogPatchSchema },
      responses: { ...blogErrorResponses, 200: { schema: blogSavedSchema } },
      docs: { summary: "Partially update a post" },
    },
    async (req, res) => {
      res.json(
        await app.services.blog.update(
          req.valid("param").slug,
          req.valid("body"),
        ),
      );
    },
  );
  app.delete(
    "/:slug",
    {
      ...admin,
      validate: { param: blogSlugSchema },
      responses: { ...blogErrorResponses, 200: { schema: blogDeletedSchema } },
      docs: { summary: "Delete a post" },
    },
    async (req, res) => {
      res.json(await app.services.blog.remove(req.valid("param").slug));
    },
  );
});
