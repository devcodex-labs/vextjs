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
 *   Node.js 18/20 无法 `require()` ESM 模块（ERR_REQUIRE_ESM）。
 *
 *   此脚本生成 CJS 入口文件，配合 package.json exports 的 `"require"` 条件，
 *   使 `require('vextjs')` 和 `require('vextjs/testing')` 正常工作。
 *
 * 生成文件：
 *   - dist/index.cjs          — 主入口 CJS bundle
 *   - dist/testing/index.cjs  — 测试工具 CJS bundle
 *
 * 运行方式：
 *   node scripts/build-cjs.mjs
 *
 * @see BUG-001 — vext dev CJS/ESM 不兼容
 * @see shared-esbuild-config.ts — dev 编译器使用 format: 'cjs'
 */

import { build } from "esbuild";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

/**
 * 所有外部依赖（不打包进 CJS bundle）
 *
 * 这些包自身支持 CJS require()，无需内联。
 * 只有 vextjs 自身的代码需要从 ESM 转为 CJS。
 */
const externalDeps = [
  // 生产依赖
  "pino",
  "pino-pretty",
  "esbuild",
  "fast-glob",
  "find-my-way",
  "flex-rate-limit",
  "monsqlize",
  "schema-dsl",
  // 可选的 peer 依赖（adapter 框架）
  "hono",
  "@hono/node-server",
  "fastify",
  "express",
  "koa",
  // Node.js 内置模块
  "node:*",
  "fs",
  "path",
  "url",
  "http",
  "https",
  "net",
  "os",
  "crypto",
  "stream",
  "events",
  "util",
  "child_process",
  "cluster",
  "module",
  "assert",
  "async_hooks",
  "worker_threads",
];

/**
 * CJS 构建入口列表
 *
 * 每个条目对应一个需要生成 CJS bundle 的 ESM 入口。
 */
const entries = [
  {
    name: "main",
    input: "dist/index.js",
    output: "dist/index.cjs",
  },
  {
    name: "testing",
    input: "dist/testing/index.js",
    output: "dist/testing/index.cjs",
  },
];

async function buildCjs() {
  const startTime = Date.now();
  let built = 0;

  for (const entry of entries) {
    const inputPath = resolve(projectRoot, entry.input);

    if (!existsSync(inputPath)) {
      console.warn(
        `⚠️  [build-cjs] Skipping ${entry.name}: ${entry.input} not found (run \`tsc\` first)`,
      );
      continue;
    }

    await build({
      entryPoints: [inputPath],
      outfile: resolve(projectRoot, entry.output),

      // ── 输出格式 ────────────────────────────────────
      format: "cjs",
      platform: "node",
      target: "node18",

      // ── 打包模式 ────────────────────────────────────
      // bundle: true — 将 vextjs 内部的多个 ESM 文件合并为单个 CJS 文件。
      // 只有 vextjs 自身模块被内联，外部依赖保持 require() 调用。
      bundle: true,

      // ── 外部依赖 ────────────────────────────────────
      external: externalDeps,

      // ── 优化选项 ────────────────────────────────────
      treeShaking: true,
      keepNames: true,
      charset: "utf8",
      sourcemap: false,

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
          '/* Auto-generated CJS entry by build-cjs.mjs — DO NOT EDIT */\n' +
          'const __vext_esm_url = require("node:url").pathToFileURL(__filename).href;',
      },
    });

    built++;
    console.log(
      `✅ [build-cjs] ${entry.name}: ${entry.input} → ${entry.output}`,
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
