#!/usr/bin/env node

/**
 * build-cjs.mjs — 生成 CJS 入口文件
 *
 * 在 `tsc` 构建 ESM 输出到 `dist/` 之后运行。
 * 使用 esbuild（已是框架依赖）将 ESM 入口打包为单文件 CJS bundle。
 *
 * 目的：
 *   vext dev 模式使用 esbuild 将用户代码编译为 CJS（为了 require.cache 热重载），
 *   编译后的用户代码会 `require('vextjs')`。但 vextjs 是 ESM-only 包，
 *   Node.js 20 无法 `require()` ESM 模块（ERR_REQUIRE_ESM）。
 *
 *   此脚本生成 CJS 入口文件，配合 package.json exports 的 `"require"` 条件，
 *   使 `require('vextjs')`、`require('vextjs/frontend')`、
 *   `require('vextjs/style')`、`require('vextjs/testing')` 和 adapter 子路径正常工作。
 *
 * 生成文件：
 *   - dist/index.cjs                  — 主入口 CJS bundle
 *   - dist/testing/index.cjs          — 测试工具 CJS bundle
 *   - dist/frontend/index.cjs         — 前端公开契约 CJS bundle
 *   - dist/frontend/style/index.cjs   — JSCSS 样式工具 CJS bundle
 *   - dist/adapters/hono/index.cjs    — Hono adapter CJS bundle
 *   - dist/adapters/fastify/index.cjs — Fastify adapter CJS bundle
 *   - dist/adapters/express/index.cjs — Express adapter CJS bundle
 *   - dist/adapters/koa/index.cjs     — Koa adapter CJS bundle
 *   - dist/adapters/native/index.cjs  — Native adapter CJS bundle
 *
 * 运行方式：
 *   node scripts/build-cjs.mjs
 *
 * @see BUG-001 — vext dev CJS/ESM 不兼容
 * @see shared-esbuild-config.ts — dev 编译器使用 format: 'cjs'
 */

import { build } from "esbuild";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoBundledRuntimeDependencies,
  runtimeDependencyNames,
} from "./validation/verify-package-composition.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8"),
);

/**
 * 所有外部依赖（不打包进 CJS bundle）
 *
 * 这些包自身支持 CJS require()，无需内联。
 * 只有 vextjs 自身的代码需要从 ESM 转为 CJS。
 */
const runtimePackages = runtimeDependencyNames(packageJson);
const externalDeps = [...runtimePackages, "node:*"];

/**
 * CJS 构建入口列表
 *
 * 每个条目对应一个需要生成 CJS bundle 的 ESM 入口。
 */
const entries = [
  { name: "main", input: "dist/index.js", output: "dist/index.cjs" },
  {
    name: "testing",
    input: "dist/testing/index.js",
    output: "dist/testing/index.cjs",
  },
  {
    name: "frontend",
    input: "dist/frontend/index.js",
    output: "dist/frontend/index.cjs",
  },
  {
    name: "style",
    input: "dist/frontend/style/index.js",
    output: "dist/frontend/style/index.cjs",
  },
  {
    name: "adapter:hono",
    input: "dist/adapters/hono/index.js",
    output: "dist/adapters/hono/index.cjs",
  },
  {
    name: "adapter:fastify",
    input: "dist/adapters/fastify/index.js",
    output: "dist/adapters/fastify/index.cjs",
  },
  {
    name: "adapter:express",
    input: "dist/adapters/express/index.js",
    output: "dist/adapters/express/index.cjs",
  },
  {
    name: "adapter:koa",
    input: "dist/adapters/koa/index.js",
    output: "dist/adapters/koa/index.cjs",
  },
  {
    name: "adapter:native",
    input: "dist/adapters/native/index.js",
    output: "dist/adapters/native/index.cjs",
  },
];

function listCjsOutputs(directory) {
  if (!existsSync(directory)) return [];
  const outputs = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) outputs.push(...listCjsOutputs(absolute));
    if (entry.isFile() && entry.name.endsWith(".cjs")) {
      outputs.push(relative(projectRoot, absolute).replaceAll("\\", "/"));
    }
  }
  return outputs.sort();
}

async function buildCjs() {
  const startTime = Date.now();
  let built = 0;

  for (const entry of entries) {
    const inputPath = resolve(projectRoot, entry.input);

    if (!existsSync(inputPath)) {
      throw new Error(
        `[build-cjs] Missing ${entry.name} input: ${entry.input} (run \`tsc\` first)`,
      );
    }

    const result = await build({
      entryPoints: [inputPath],
      outfile: resolve(projectRoot, entry.output),

      // ── 输出格式 ────────────────────────────────────
      format: "cjs",
      platform: "node",
      target: "node20",

      // ── 打包模式 ────────────────────────────────────
      // bundle: true — 将 vextjs 内部的多个 ESM 文件合并为单个 CJS 文件。
      // 只有 vextjs 自身模块被内联，外部依赖保持 require() 调用。
      bundle: true,

      // ── 外部依赖 ────────────────────────────────────
      external: externalDeps,

      // ── 优化选项 ────────────────────────────────────
      treeShaking: true,
      keepNames: true,
      minifyWhitespace: true,
      minifySyntax: true,
      minifyIdentifiers: false,
      charset: "utf8",
      sourcemap: false,
      metafile: true,

      // ── 日志 ────────────────────────────────────────
      logLevel: "warning",

      // ── import.meta.url CJS 兼容 ────────────────────
      // 源代码中（如 plugin-loader.ts）使用 createRequire(import.meta.url)，
      // 在 CJS bundle 上下文中 import.meta 是 undefined。
      // 用 __filename 通过 pathToFileURL 模拟为 file:// URL。
      define: {
        "import.meta.url": "__vext_esm_url",
      },

      // ── Banner ──────────────────────────────────────
      // 注入 import.meta.url 的 CJS 等价物 + 标记文件为自动生成
      banner: {
        js:
          "/* Auto-generated CJS entry by build-cjs.mjs — DO NOT EDIT */\n" +
          'const __vext_esm_url = require("node:url").pathToFileURL(__filename).href;',
      },
    });

    assertNoBundledRuntimeDependencies(
      result.metafile,
      runtimePackages,
      `[build-cjs] ${entry.name}`,
    );

    built++;
    console.log(
      `✅ [build-cjs] ${entry.name}: ${entry.input} → ${entry.output}`,
    );
  }

  if (built !== entries.length) {
    throw new Error(
      `[build-cjs] Expected ${entries.length} outputs, generated ${built}`,
    );
  }
  const expectedOutputs = entries.map((entry) => entry.output).sort();
  const actualOutputs = listCjsOutputs(resolve(projectRoot, "dist"));
  if (JSON.stringify(actualOutputs) !== JSON.stringify(expectedOutputs)) {
    throw new Error(
      `[build-cjs] CJS output set mismatch: expected ${expectedOutputs.join(", ")}; found ${actualOutputs.join(", ")}`,
    );
  }

  const elapsed = Date.now() - startTime;
  console.log(
    `\n🎉 [build-cjs] ${built} CJS bundle(s) generated in ${elapsed}ms`,
  );
}

buildCjs().catch((err) => {
  console.error("❌ [build-cjs] Failed:", err.message);
  process.exit(1);
});
