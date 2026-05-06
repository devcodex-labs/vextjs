#!/usr/bin/env node

import { startCommand } from "./start.js";
import { devCommand } from "./dev.js";
import { buildCommand } from "./build.js";
import { createCommand } from "./create.js";
import { stopCommand } from "./stop.js";
import { reloadCommand } from "./reload.js";
import { statusCommand } from "./status.js";
import { typegenCommand } from "./typegen.js";

/**
 * vext CLI — 框架命令行入口（Phase 1）
 *
 * 命令分发：
 *   vext start   — 生产模式启动
 *   vext dev     — 开发模式启动（Phase 2A 实现）
 *   vext build   — 编译 TS → JS（Phase 2A 实现）
 *   vext create  — 项目脚手架（Phase 4 实现 ✅）
 *
 * 命令解析：
 *   使用 Node.js 内置 util.parseArgs（Node 18.3+ / 16.17+），
 *   零依赖实现命令行参数解析。
 *
 * 默认命令：
 *   不传命令时默认执行 start（与 npm start 行为一致）。
 *
 * 用法：
 *   npx vext start              启动生产模式
 *   npx vext start --port 8080  指定端口
 *   npx vext --help             查看帮助
 *   npx vext --version          查看版本号
 *
 * @module cli/index
 * @see 09-cli.md §1（CLI 入口）
 * @see IMPLEMENTATION-PLAN.md 任务 1.18
 */

// ── 命令注册表 ──────────────────────────────────────────────
//
// 各命令的 handler 函数。
// 使用 Record 方便后续 Phase 扩展新命令（dev / build / create）。
//

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  start: startCommand,
  dev: devCommand,
  build: buildCommand,
  create: createCommand,
  stop: stopCommand,
  reload: reloadCommand,
  status: statusCommand,
  typegen: typegenCommand,
};

// ── 未实现命令占位 ──────────────────────────────────────────

const _COMING_SOON: Record<string, string> = {};

// ── 主函数 ──────────────────────────────────────────────────

async function main(): Promise<void> {
  // ── Windows UTF-8 控制台初始化 ─────────────────────────────
  //
  // 问题：Windows 控制台默认代码页为 GBK（CP936）。
  // vext dev 的子进程通过 stdio:'inherit' 直接写入同一控制台句柄，
  // 导致 UTF-8 多字节字符（中文 / emoji）被控制台误读为 GBK，显示为乱码。
  //
  // 修复：在进程启动最早期将代码页切换为 UTF-8（65001），
  // 子进程继承该控制台句柄后所有后续输出均可正确显示。
  //
  // 安全性：try-catch 保护，非致命 —— 某些受限环境（如 CI 容器）
  // 可能不提供 chcp，此时静默忽略，不影响启动流程。
  if (process.platform === "win32") {
    try {
      const { execSync } = await import("node:child_process");
      execSync("chcp 65001", { stdio: "ignore" });
    } catch {
      // 非致命：chcp 不可用时静默忽略
    }
  }

  const args = process.argv.slice(2);

  // 第一个参数如果不以 - 开头，则视为命令名
  const firstArg = args[0];

  // ── --help ──────────────────────────────────────────────
  if (firstArg === "--help" || firstArg === "-h") {
    printHelp();
    process.exit(0);
  }

  // ── --version ──────────────────────────────────────────
  if (firstArg === "--version" || firstArg === "-v") {
    await printVersion();
    process.exit(0);
  }

  // ── 命令解析 ────────────────────────────────────────────
  //
  // 规则：
  //   1. 第一个非 - 开头的参数作为命令名
  //   2. 不传命令时默认 'start'
  //   3. 命令后的参数传递给对应的 handler
  //
  let command: string;
  let commandArgs: string[];

  if (!firstArg || firstArg.startsWith("-")) {
    // 无命令或第一个参数是选项 → 默认 start，所有参数传给 start
    command = "start";
    commandArgs = args;
  } else {
    command = firstArg;
    commandArgs = args.slice(1);
  }

  // ── 分发到对应的命令 handler ────────────────────────────
  const handler = COMMANDS[command];

  if (!handler) {
    console.error(`[vextjs] Unknown command: "${command}"\n`);
    printHelp();
    process.exit(1);
  }

  await handler(commandArgs);
}

// ── 帮助输出 ────────────────────────────────────────────────

/**
 * 打印全局帮助信息
 *
 * 列出所有可用命令和全局选项。
 * 未实现的命令标注 (coming soon)。
 */
function printHelp(): void {
  console.log(`
  Usage: vext <command> [options]

  Commands:
    create <name>         Create a new vext project
    start                 Start the application in production mode
    dev                   Start with hot reload (development mode)
    build                 Build the application for production
    stop                  Stop the running server (cluster mode)
    reload                Trigger zero-downtime rolling restart (cluster mode)
    status                Show server status (cluster mode)
    typegen               Generate declarations and run tooling diagnostics (experimental)

  Global options:
    -h, --help            Show this help message
    -v, --version         Show version number

  Command options:
    vext create --help    Show create command options
    vext start --help     Show start command options
    vext stop --help      Show stop command options
    vext reload --help    Show reload command options
    vext status --help    Show status command options
    vext typegen --help   Show typegen command options

  Examples:
    $ vext create my-app
    $ vext start
    $ vext start --port 8080 --host 0.0.0.0
    $ vext                                    (defaults to "start")
`);
}

// ── 版本输出 ────────────────────────────────────────────────

/**
 * 打印版本号
 *
 * 从 package.json 读取版本号。
 * 使用 createRequire 动态加载，避免硬编码版本。
 *
 * 兜底策略：读取失败时输出固定版本 'unknown'。
 */
async function printVersion(): Promise<void> {
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version: string };
    console.log(`vextjs v${pkg.version}`);
  } catch {
    // package.json 读取失败（极少发生，如路径变更）
    console.log("vextjs vunknown");
  }
}

// ── 执行入口 ────────────────────────────────────────────────

main().catch((err) => {
  // 未捕获的顶层异常（通常不应发生，各命令 handler 内部已有 try-catch）
  console.error("[vextjs] CLI unexpected error:", err);
  process.exit(1);
});
