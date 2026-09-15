import { defineRoutes } from "vextjs";
import { blogQuerySchema, blogSlugSchema } from "../schemas/blog.js";

const pageQuery = {
  ...blogQuerySchema,
  search: "string:0-120?",
  lang: "enum:en-US|zh-CN?",
} as const;
const languageQuery = { lang: "enum:en-US|zh-CN?" } as const;

/** Page navigation never carries an admin token; /admin renders only the anonymous shell. */
export default defineRoutes((app) => {
  app.get(
    "/",
    {
      validate: { query: pageQuery },
      frontend: { page: "blog/index" },
      cache: false,
      docs: { summary: "Published blog page" },
    },
    async (req, res) => {
      const { lang, ...query } = req.valid("query");
      const locale = lang ?? "en-US";
      res.render(
        "blog/index",
        {
          page: await app.services.blog.list({
            ...query,
            search: query.search?.trim() || undefined,
          }),
          query,
          locale,
        },
        { locale },
      );
    },
  );
  app.get(
    "/posts/:slug",
    {
      validate: { param: blogSlugSchema, query: languageQuery },
      frontend: { page: "blog/detail" },
      cache: false,
      docs: { summary: "Published article page" },
    },
    async (req, res) => {
      const slug = req.valid("param").slug;
      const locale = req.valid("query").lang ?? "en-US";
      res.render(
        "blog/detail",
        {
          post: await app.services.blog.read(slug),
          related: await app.services.blog.related(slug),
          locale,
        },
        { locale },
      );
    },
  );
  app.get(
    "/admin",
    {
      validate: { query: languageQuery },
      frontend: { page: "blog/admin" },
      cache: false,
      docs: { summary: "Anonymous administration shell" },
    },
    (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      res.render(
        "blog/admin",
        {},
        { locale: req.valid("query").lang ?? "en-US" },
      );
    },
  );
});
