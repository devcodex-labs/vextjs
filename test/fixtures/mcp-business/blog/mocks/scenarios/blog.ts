import { blogData as blogSamples } from "../data/blog.js";

/** Side-effect-free scenarios for UI development; requests never import or install these rows. */
export const blogScenarios = {
  empty: [],
  published: blogSamples.filter((post) => post.status === "published"),
  drafts: blogSamples.filter((post) => post.status === "draft"),
};
