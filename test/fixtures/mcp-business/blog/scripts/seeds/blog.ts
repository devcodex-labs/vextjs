import { bootstrapJobRuntime } from "vextjs";
import { blogData as blogSamples } from "../../mocks/data/blog.js";
import type { BlogPostDocument } from "../../src/types/server/models/blog-post.js";
import { isDuplicateBlogSlug } from "../../src/utils/server/blog.js";

// Reuse the public headless lifecycle/config/model loader. No HTTP listener or scheduled job is started.
const runtime = await bootstrapJobRuntime({
  rootDir: process.cwd(),
  built: true,
  configProfile: process.argv[2],
});
try {
  if (!runtime.app.db)
    throw new Error("Configure the blog database before running seed");
  console.log(
    JSON.stringify({
      operation: "explicit-blog-seed",
      database: runtime.config.database?.config,
      collection: "blog_posts",
    }),
  );
  const posts = runtime.app.db.model<BlogPostDocument>("BlogPost");
  for (const post of blogSamples) {
    try {
      // Existing posts and user edits stay untouched, including when seeds run concurrently.
      await posts.upsertOne({ slug: post.slug }, { $setOnInsert: post });
    } catch (error) {
      if (
        !isDuplicateBlogSlug(error) ||
        !(await posts.findOne({ slug: post.slug }))
      )
        throw error;
    }
  }
  console.log(JSON.stringify({ seeded: blogSamples.length }));
} finally {
  await runtime.close();
}
