import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (...parts) => pathToFileURL(path.join(root, "dist", ...parts)).href;

const cjsEntrypoints = [
  "vextjs",
  "vextjs/testing",
  "vextjs/adapters/hono",
  "vextjs/adapters/fastify",
  "vextjs/adapters/express",
  "vextjs/adapters/koa",
  "vextjs/adapters/native",
];
const esmEntrypoints = [
  dist("index.js"),
  dist("testing", "index.js"),
  dist("adapters", "hono", "index.js"),
  dist("adapters", "fastify", "index.js"),
  dist("adapters", "express", "index.js"),
  dist("adapters", "koa", "index.js"),
  dist("adapters", "native", "index.js"),
];

for (const entry of cjsEntrypoints) {
  const mod = require(entry);
  if (!mod || typeof mod !== "object") throw new Error(`CJS export did not load: ${entry}`);
}
for (const entry of esmEntrypoints) {
  const mod = await import(entry);
  if (!mod || typeof mod !== "object") throw new Error(`ESM export did not load: ${entry}`);
}
console.log("package exports verified");
