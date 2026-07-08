import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (...parts) =>
  pathToFileURL(path.join(root, "dist", ...parts)).href;

const cjsEntrypoints = [
  "vextjs",
  "vextjs/testing",
  "vextjs/frontend",
  "vextjs/style",
  "vextjs/adapters/hono",
  "vextjs/adapters/fastify",
  "vextjs/adapters/express",
  "vextjs/adapters/koa",
  "vextjs/adapters/native",
];
const esmEntrypoints = [
  dist("index.js"),
  dist("testing", "index.js"),
  dist("frontend", "index.js"),
  dist("frontend", "style", "index.js"),
  dist("adapters", "hono", "index.js"),
  dist("adapters", "fastify", "index.js"),
  dist("adapters", "express", "index.js"),
  dist("adapters", "koa", "index.js"),
  dist("adapters", "native", "index.js"),
];
const namedExports = {
  vextjs: [
    "createCsrfMiddleware",
    "createSecurityHeadersMiddleware",
    "csrf",
    "securityHeaders",
  ],
  "vextjs/frontend": [
    "VextApiError",
    "createVextApiClient",
    "defineFrontendAdapter",
    "isVextApiError",
  ],
  "vextjs/style": [
    "createVar",
    "globalStyle",
    "recipe",
    "setVar",
    "style",
    "vars",
  ],
  "vextjs/adapters/hono": ["createHonoAdapter", "honoAdapter"],
  "vextjs/adapters/fastify": ["createFastifyAdapter", "fastifyAdapter"],
  "vextjs/adapters/express": ["createExpressAdapter", "expressAdapter"],
  "vextjs/adapters/koa": ["createKoaAdapter", "koaAdapter"],
  "vextjs/adapters/native": ["createNativeAdapter", "nativeAdapter"],
};
const esmNamedExports = new Map([
  [dist("index.js"), namedExports.vextjs],
  [dist("frontend", "index.js"), namedExports["vextjs/frontend"]],
  [dist("frontend", "style", "index.js"), namedExports["vextjs/style"]],
  [dist("adapters", "hono", "index.js"), namedExports["vextjs/adapters/hono"]],
  [
    dist("adapters", "fastify", "index.js"),
    namedExports["vextjs/adapters/fastify"],
  ],
  [
    dist("adapters", "express", "index.js"),
    namedExports["vextjs/adapters/express"],
  ],
  [dist("adapters", "koa", "index.js"), namedExports["vextjs/adapters/koa"]],
  [
    dist("adapters", "native", "index.js"),
    namedExports["vextjs/adapters/native"],
  ],
]);
const cjsOutputFiles = [
  path.join(root, "dist", "index.cjs"),
  path.join(root, "dist", "testing", "index.cjs"),
  path.join(root, "dist", "frontend", "index.cjs"),
  path.join(root, "dist", "frontend", "style", "index.cjs"),
  path.join(root, "dist", "adapters", "hono", "index.cjs"),
  path.join(root, "dist", "adapters", "fastify", "index.cjs"),
  path.join(root, "dist", "adapters", "express", "index.cjs"),
  path.join(root, "dist", "adapters", "koa", "index.cjs"),
  path.join(root, "dist", "adapters", "native", "index.cjs"),
];
const forbiddenBundledRuntimeModules = [
  "response-cache-kit",
  "cache-hub",
  "pino",
  "pino-pretty",
];

for (const entry of cjsEntrypoints) {
  const mod = require(entry);
  if (!mod || typeof mod !== "object")
    throw new Error(`CJS export did not load: ${entry}`);
  for (const name of namedExports[entry] ?? []) {
    if (!(name in mod)) throw new Error(`CJS export missing ${name}: ${entry}`);
  }
}
for (const entry of esmEntrypoints) {
  const mod = await import(entry);
  if (!mod || typeof mod !== "object")
    throw new Error(`ESM export did not load: ${entry}`);
  for (const name of esmNamedExports.get(entry) ?? []) {
    if (!(name in mod)) throw new Error(`ESM export missing ${name}: ${entry}`);
  }
}
for (const file of cjsOutputFiles) {
  const content = readFileSync(file, "utf8");
  for (const moduleName of forbiddenBundledRuntimeModules) {
    if (content.includes(`node_modules/${moduleName}`)) {
      throw new Error(
        `CJS bundle unexpectedly inlined ${moduleName}: ${path.relative(root, file)}`,
      );
    }
  }
}
console.log("package exports verified");
