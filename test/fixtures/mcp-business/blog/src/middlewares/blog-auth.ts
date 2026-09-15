import { timingSafeEqual } from "node:crypto";
import { defineMiddleware } from "vextjs";

/** This middleware must run before any admin query, including list and statistics. */
export default defineMiddleware(async (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  const expected = req.app.config.blogAdminToken;
  if (typeof expected !== "string" || !expected)
    return req.app.throw(
      503,
      "blog.errors.adminUnavailable",
      "BLOG_ADMIN_UNAVAILABLE",
    );
  const received = req.headers.authorization?.replace(/^Bearer /u, "") ?? "";
  const actualBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  )
    req.app.throw(401, "blog.errors.unauthorized", "BLOG_UNAUTHORIZED");
  await next();
});
