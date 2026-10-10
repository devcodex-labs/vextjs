import { createApp, createMonSQLizePlugin, loadConfig } from "vextjs";
import path from "node:path";
import { blogData as blogSamples } from "../../mocks/data/blog.js";
import type { BlogPostDocument } from "../../src/types/server/models/blog-post.js";
import { isDuplicateBlogSlug } from "../../src/utils/server/blog.js";

// An explicit seed initializes only the database plugin: no listener or scheduled tasks.
const rootDir = process.cwd();
const srcDir = path.join(rootDir, "dist");
const config = await loadConfig(path.join(srcDir, "config"), {
  rootDir,
  command: "start",
  isBuilt: true,
  mode: "production",
  configProfile: process.argv[2],
});
const { app, internals } = createApp(config);
try {
  internals.enterPluginSetup();
  try {
    await createMonSQLizePlugin(srcDir, rootDir).setup(app, {
      signal: new AbortController().signal,
    });
  } finally {
    internals.exitPluginSetup();
  }
  await internals.runReady();
  if (!app.db)
    throw new Error("Configure the blog database before running seed");
  console.log(
    JSON.stringify({
      operation: "explicit-blog-seed",
      database: config.database?.config,
      collection: "blog_posts",
    }),
  );
  const posts = app.db.model<BlogPostDocument>("BlogPost");
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
  await internals.shutdown(undefined, { skipExit: true });
}
