import { defineRoutes } from "vextjs";
import {
  blogQuerySchema,
  blogSlugSchema,
  blogPageSchema,
  blogPostSchema,
  blogStatsSchema,
  blogErrorResponses,
} from "../../schemas/blog.js";

/** All public queries enforce published status in the service, including counts and related posts. */
const cache = { ttl: 300, tags: ["blog-public"] };
export default defineRoutes((app) => {
  app.get(
    "/",
    {
      validate: { query: blogQuerySchema },
      cache,
      responses: { ...blogErrorResponses, 200: { schema: blogPageSchema } },
      docs: { summary: "List published posts" },
    },
    async (req, res) => {
      res.json(await app.services.blog.list(req.valid("query")));
    },
  );
  app.get(
    "/stats",
    {
      cache,
      responses: { 200: { schema: blogStatsSchema } },
      docs: { summary: "Published blog statistics" },
    },
    async (_req, res) => {
      res.json(await app.services.blog.stats());
    },
  );
  app.get(
    "/featured",
    {
      cache,
      responses: { 200: { schema: { type: "array", items: blogPostSchema } } },
      docs: { summary: "Featured published posts" },
    },
    async (_req, res) => {
      res.json(await app.services.blog.featured());
    },
  );
  app.get(
    "/:slug/related",
    {
      validate: { param: blogSlugSchema },
      cache,
      responses: {
        ...blogErrorResponses,
        200: { schema: { type: "array", items: blogPostSchema } },
      },
      docs: { summary: "Related published posts" },
    },
    async (req, res) => {
      res.json(await app.services.blog.related(req.valid("param").slug));
    },
  );
  app.get(
    "/:slug",
    {
      validate: { param: blogSlugSchema },
      cache,
      responses: { ...blogErrorResponses, 200: { schema: blogPostSchema } },
      docs: { summary: "Read a published post" },
    },
    async (req, res) => {
      res.json(await app.services.blog.read(req.valid("param").slug));
    },
  );
});
