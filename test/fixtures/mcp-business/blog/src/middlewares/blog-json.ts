import { defineMiddleware } from "vextjs";
import { blogJsonTypeIssue } from "../validators/blog.js";

/** Preserve strict JSON types before the default validator performs useful query/body coercion. */
export default defineMiddleware(async (req, _res, next) => {
  const issue = blogJsonTypeIssue(req.body);
  if (issue)
    req.app.throw(
      422,
      "blog.errors.invalid",
      { field: issue },
      "BLOG_INPUT_INVALID",
    );
  await next();
});
