import path from "node:path";
import { rmSync, existsSync } from "node:fs";
import { detectProject } from "./utils/detect-project.js";
import { BuildCompiler } from "../lib/build/build-compiler.js";

/**
 * vext build — 生产编译命令（Phase 2A）
 *
 * 将用户项目的 TypeScript 源码通过 esbuild 编译为 JavaScript，
 * 输出到 dist/ 目录。编译完成后，`vext start` 检测到 dist/ 存在时
 * 直接用 `node` 运行，不再依赖 tsx 运行时。
 *
 * 命令行参数：
 *   --outdir <path>    输出目录（默认 'dist'）
 *   --clean            编译前清理输出目录（默认 false）
 *   --no-sourcemap     不生成 source map（默认生成）
 *   --minify           代码压缩（默认 false）
 *   --typecheck        编译前执行 TypeScript 类型检查（默认 false）
 *   -h, --help         显示帮助信息
 *
 * 用法示例：
 *   vext build                    基本编译
 *   vext build --clean            清理旧产物后编译
 *   vext build --outdir build     指定输出目录
 *   vext build --no-sourcemap     不生成 source map
 *   vext build --minify           生产优化（压缩代码）
 *   vext build --typecheck        编译前执行类型检查
 *   vext build --clean --minify --typecheck   完整生产构建
 *
 * 环境变量：
 *   VEXT_BUILD_OUTDIR      覆盖输出目录（优先级低于 CLI 参数）
 *   VEXT_BUILD_SOURCEMAP   设为 'false' 禁用 source map
 *   VEXT_BUILD_MINIFY      设为 'true' 启用代码压缩
 *
 * @module cli/build
 * @see 09a-build.md §3（CLI 入口实现）
 * @see IMPLEMENTATION-PLAN.md 任务 2.5
 */

// ── 类型定义 ────────────────────────────────────────────────

interface BuildCommandOptions {
  /** 输出目录（相对于项目根目录） */
  outdir: string;

  /** 编译前清理输出目录 */
  clean: boolean;

  /** 生成 source map */
  sourcemap: boolean;

  /** 代码压缩 */
  minify: boolean;

  /** 编译前执行 TypeScript 类型检查 */
  typecheck: boolean;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * buildCommand — vext build CLI 命令入口
 *
 * 解析命令行参数，检测项目结构，执行编译，输出报告。
 *
 * 流程：
 *   1. 解析命令行参数（CLI 参数 > 环境变量 > 默认值）
 *   2. detectProject() 检测项目结构
 *   3. JavaScript 项目 → 提示无需编译并退出
 *   4. --clean → 清理旧产物
 *   5. --typecheck → 执行 tsc --noEmit
 *   6. BuildCompiler.build() 执行编译
 *   7. 输出编译报告（文件数、耗时、输出目录）
 *
 * @param args 命令行参数（如 ['--clean', '--minify']）
 */
export async function buildCommand(args: string[] = []): Promise<void> {
  // ── 解析命令行参数 ────────────────────────────────────────
  const options = parseBuildArgs(args);

  // ── 检测项目结构 ──────────────────────────────────────────
  const rootDir = path.resolve(process.cwd());
  const project = detectProject(rootDir);

  // ── JavaScript 项目跳过编译 ───────────────────────────────
  if (project.language !== "ts") {
    console.log("[vextjs] JavaScript project detected — no build step needed.");
    console.log("[vextjs] Use \"vext start\" directly.");
    return;
  }

  const outDir = path.resolve(project.rootDir, options.outdir);

  // ── 打印编译信息 ──────────────────────────────────────────
  console.log("[vextjs] build — TypeScript → JavaScript");
  console.log(`[vextjs] src:  ${project.srcDir}`);
  console.log(`[vextjs] out:  ${outDir}`);

  if (options.minify) {
    console.log("[vextjs] minify: enabled");
  }
  if (!options.sourcemap) {
    console.log("[vextjs] sourcemap: disabled");
  }

  // ── 清理旧产物（--clean） ─────────────────────────────────
  if (options.clean && existsSync(outDir)) {
    rmSync(outDir, { recursive: true });
    console.log(`[vextjs] cleaned: ${outDir}`);
  }

  // ── 类型检查（--typecheck，可选） ─────────────────────────
  if (options.typecheck) {
    console.log("[vextjs] running type check...");

    try {
      const { execSync } = await import("node:child_process");
      execSync("npx tsc --noEmit", {
        cwd: project.rootDir,
        stdio: "inherit",
      });
      console.log("[vextjs] type check passed ✓");
    } catch {
      console.error("[vextjs] type check failed — build aborted");
      process.exit(1);
    }
  }

  // ── 编译 ──────────────────────────────────────────────────
  const compiler = new BuildCompiler({
    rootDir: project.rootDir,
    srcDir: project.srcDir,
    outDir,
    sourcemap: options.sourcemap,
    minify: options.minify,
  });

  try {
    const result = await compiler.build();

    if (!result.success) {
      console.error(
        `[vextjs] build failed with ${result.errors.length} error(s)`,
      );
      for (const err of result.errors) {
        const loc = err.location;
        if (loc) {
          console.error(`  ${loc.file}:${loc.line} — ${err.text}`);
        } else {
          console.error(`  ${err.text}`);
        }
      }
      process.exit(1);
    }

    // ── 输出警告信息 ──────────────────────────────────────
    if (result.warnings.length > 0) {
      console.log(`[vextjs] ⚠️  ${result.warnings.length} warning(s):`);
      for (const w of result.warnings) {
        const loc = w.location;
        if (loc) {
          console.log(`  ${loc.file}:${loc.line} — ${w.text}`);
        } else {
          console.log(`  ${w.text}`);
        }
      }
    }

    // ── 输出编译报告 ────────────────────────────────────────
    console.log("");
    console.log("[vextjs] ✅ build complete");
    console.log(`[vextjs]    files:   ${result.fileCount}`);
    console.log(`[vextjs]    time:    ${result.elapsed}ms`);
    console.log(`[vextjs]    output:  ${result.outDir}/`);
    console.log("");
    console.log("[vextjs] To start in production:");
    console.log("[vextjs]   NODE_ENV=production vext start");
  } catch (err) {
    console.error("[vextjs] build failed:");
    console.error(err);
    process.exit(1);
  }
}

// ── 参数解析 ────────────────────────────────────────────────

/**
 * parseBuildArgs — 解析 vext build 的命令行参数
 *
 * 优先级：CLI 参数 > 环境变量 > 默认值
 *
 * 手动解析（不引入第三方 CLI 库），保持零依赖。
 *
 * 支持的参数：
 *   --outdir <path>    输出目录（默认 'dist'）
 *   --clean            编译前清理（默认 false）
 *   --sourcemap        生成 source map（默认 true）
 *   --no-sourcemap     不生成 source map
 *   --minify           代码压缩（默认 false）
 *   --typecheck        类型检查（默认 false）
 *   -h, --help         显示帮助信息
 *
 * @param args 命令行参数数组
 * @returns 解析后的选项
 */
export function parseBuildArgs(args: string[]): BuildCommandOptions {
  // 默认值（环境变量覆盖）
  const options: BuildCommandOptions = {
    outdir: process.env.VEXT_BUILD_OUTDIR || "dist",
    clean: false,
    sourcemap: process.env.VEXT_BUILD_SOURCEMAP !== "false",
    minify: process.env.VEXT_BUILD_MINIFY === "true",
    typecheck: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--outdir":
        if (i + 1 >= args.length) {
          console.error("[vextjs] --outdir requires a value");
          process.exit(1);
        }
        options.outdir = args[++i]!;
        break;

      case "--clean":
        options.clean = true;
        break;

      case "--sourcemap":
        options.sourcemap = true;
        break;

      case "--no-sourcemap":
        options.sourcemap = false;
        break;

      case "--minify":
        options.minify = true;
        break;

      case "--typecheck":
        options.typecheck = true;
        break;

      case "--help":
      case "-h":
        printBuildHelp();
        process.exit(0);
        break;

      default:
        if (arg?.startsWith("--")) {
          console.error(`[vextjs] Unknown option: "${arg}"\n`);
          printBuildHelp();
          process.exit(1);
        }
        break;
    }
  }

  return options;
}

// ── 帮助输出 ────────────────────────────────────────────────

/**
 * 打印 vext build 的帮助信息
 */
function printBuildHelp(): void {
  console.log(`
  Usage: vext build [options]

  Compile TypeScript source to JavaScript for production deployment.

  Options:
    --outdir <path>    Output directory (default: "dist")
    --clean            Clean output directory before build
    --sourcemap        Generate source maps (default: true)
    --no-sourcemap     Disable source map generation
    --minify           Minify output code
    --typecheck        Run TypeScript type check before build
    -h, --help         Show this help message

  Environment variables:
    VEXT_BUILD_OUTDIR      Override output directory
    VEXT_BUILD_SOURCEMAP   Set to "false" to disable source maps
    VEXT_BUILD_MINIFY      Set to "true" to enable minification

  Examples:
    $ vext build
    $ vext build --clean
    $ vext build --clean --minify --typecheck
    $ vext build --outdir build
    $ vext build --no-sourcemap

  After building, start with:
    $ NODE_ENV=production vext start
`);
}
