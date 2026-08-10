/**
 * change-classifier.ts — 文件变更分类器（Phase 2A）
 *
 * 将文件变更分类为四种动作之一：
 *   - `cold`   — 冷重启（配置文件、插件、package.json、tsconfig.json、.env 等）
 *   - `soft`   — 热替换（src/ 下的源码文件：.ts/.js/.mjs/.cjs）
 *   - `client` — 前端 client rebuild（src/frontend 与 public）
 *   - `ignore` — 忽略（node_modules、dist、.git、测试文件、文档等）
 *
 * 分类器在 FileWatcher 的 onFileChange 回调中调用，
 * 决定变更文件应触发 Cold Restart 还是 Soft Reload。
 *
 * 支持用户自定义分类规则：
 *   - coldPatterns: 额外的冷重启文件模式（glob 字符串）
 *   - ignorePatterns: 额外的忽略文件模式（glob 字符串）
 *
 * @module lib/dev/change-classifier
 * @see 11c-file-watcher.md §2（变更分类器）
 * @see 11-hot-reload.md §3（文件分类规则）
 * @see IMPLEMENTATION-PLAN.md 任务 2.3
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * 变更分类结果
 */
export interface ChangeClassification {
  /** 应执行的动作：cold=冷重启, soft=热替换, client=前端重建, ignore=忽略 */
  action: "cold" | "soft" | "client" | "ignore";

  /** 分类原因（调试/日志用） */
  reason: string;
}

/**
 * 用户自定义分类选项
 *
 * 通过 config.dev.coldPatterns / config.dev.ignorePatterns 配置。
 * 用户自定义规则优先级高于内置规则。
 */
export interface ClassifierOptions {
  /**
   * 额外的冷重启文件模式（glob 风格字符串）
   *
   * 匹配的文件将触发冷重启而非热替换。
   * 适用于业务中需要冷重启的特殊文件（如数据库 schema 变更文件）。
   *
   * 示例: `['src/lib/database-schema.ts', 'src/lib/migrations/...']`
   */
  coldPatterns?: string[];

  /**
   * 额外的忽略文件模式（glob 风格字符串）
   *
   * 匹配的文件不会触发任何重载动作。
   * 适用于自动生成的文件或不需要监听的文件。
   *
   * 示例: `['src/generated/...', 'src/.../*.generated.ts']`
   */
  ignorePatterns?: string[];
}

// ── 内置分类规则 ────────────────────────────────────────────

/**
 * 内置冷重启模式
 *
 * 匹配的文件变更将触发 Cold Restart（进程级重启），
 * 因为这些文件的变更通常影响应用的初始化阶段，
 * 无法通过清除 require.cache 来安全地热替换。
 *
 * 设计依据（11-hot-reload.md §3 文件分类规则）：
 *   - config/ — 配置影响 bootstrap 阶段的行为（端口、中间件列表等）
 *   - plugins/ — 插件在 setup() 阶段注册钩子和中间件，无法安全卸载
 *   - src/preload/ — 项目级 preload 在应用代码前执行，变更后需完整重启才能重新注入
 *   - preload/ — 兼容旧项目的根目录 preload，遵循同一冷重启语义
 *   - package.json / lockfile — 依赖变更需要重新安装和加载
 *   - tsconfig.json — 编译配置变更需要重建 esbuild context
 *   - .env — 环境变量在进程启动时读取，修改后需重启生效
 */
const COLD_PATTERNS: RegExp[] = [
  /^src\/config\//,
  /^src\/preload\//,
  /^preload\//,
  /^package\.json$/,
  /^(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|bun\.lock)$/,
  /^\.env(\..+)?$/,
  /^src\/plugins\//,
  /^tsconfig\.json$/,
];

/**
 * 内置忽略模式
 *
 * 匹配的文件变更将被静默忽略，不触发任何重载动作。
 * 这些文件要么不影响运行时行为，要么是编译产物/第三方代码。
 */
const IGNORE_PATTERNS: RegExp[] = [
  /^node_modules\//,
  /^dist\//,
  /^build\//,
  /^\.vext\//,
  /^\.git\//,
  /^src\/types\/generated\//,
  /^tests?\//,
  /\.(md|txt|log|lock)$/,
  /^plans\//,
  /^docs\//,
];

const FRONTEND_CLIENT_PATTERNS: RegExp[] = [/^src\/frontend\//, /^public\//];

/**
 * 源码文件模式
 *
 * src/ 下的代码文件走 soft reload 路径（Tier 1 或 Tier 2 编译）。
 * 只匹配代码文件扩展名，排除 src/ 下的非代码文件（如 README.md）。
 */
const SOURCE_PATTERN = /^src\/.*\.(ts|mts|cts|js|mjs|cjs)$/;

// ── 分类函数 ────────────────────────────────────────────────

/**
 * classifyChange — 对单个文件变更进行分类
 *
 * 分类优先级（从高到低）：
 *   1. 用户自定义 ignorePatterns → ignore
 *   2. 用户自定义 coldPatterns → cold
 *   3. 内置 COLD_PATTERNS → cold
 *   4. 内置 IGNORE_PATTERNS → ignore
 *   5. src/frontend 与 public → client
 *   6. src/ 下的源码文件 → soft
 *   7. 其他 → ignore
 *
 * @param relativePath 相对于项目根目录的文件路径（使用 / 分隔符）
 * @param options 用户自定义分类选项（可选）
 * @returns 分类结果（action + reason）
 *
 * @example
 * ```ts
 * classifyChange('src/routes/user.ts')
 * // → { action: 'soft', reason: 'source code change' }
 *
 * classifyChange('src/config/default.ts')
 * // → { action: 'cold', reason: 'config/plugin change: /^src\\/config\\//' }
 *
 * classifyChange('node_modules/express/index.js')
 * // → { action: 'ignore', reason: 'matched ignore pattern: /^node_modules\\//' }
 * ```
 */
export function classifyChange(
  relativePath: string,
  options?: ClassifierOptions,
): ChangeClassification {
  // 路径规范化：确保使用 / 分隔符（Windows 兼容）
  const normalized = relativePath.replace(/\\/g, "/");

  // ── 1. 用户自定义 ignorePatterns（最高优先级）────────────
  if (options?.ignorePatterns) {
    for (const pattern of options.ignorePatterns) {
      if (matchGlobPattern(normalized, pattern)) {
        return {
          action: "ignore",
          reason: `user ignore pattern: ${pattern}`,
        };
      }
    }
  }

  // ── 2. 用户自定义 coldPatterns ──────────────────────────
  if (options?.coldPatterns) {
    for (const pattern of options.coldPatterns) {
      if (matchGlobPattern(normalized, pattern)) {
        return {
          action: "cold",
          reason: `user cold pattern: ${pattern}`,
        };
      }
    }
  }

  // ── 3. 内置 COLD_PATTERNS ─────────────────────────────
  for (const pattern of COLD_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        action: "cold",
        reason: `config/plugin change: ${pattern}`,
      };
    }
  }

  // ── 4. 内置 IGNORE_PATTERNS ────────────────────────────
  for (const pattern of IGNORE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        action: "ignore",
        reason: `matched ignore pattern: ${pattern}`,
      };
    }
  }

  // ── 5. client assets → frontend rebuild ───────────────
  for (const pattern of FRONTEND_CLIENT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { action: "client", reason: `frontend client change: ${pattern}` };
    }
  }

  // ── 6. src/ 下的源码文件 → soft ───────────────────────
  if (SOURCE_PATTERN.test(normalized)) {
    return { action: "soft", reason: "source code change" };
  }

  // ── 7. 其他文件 → ignore ──────────────────────────────
  return { action: "ignore", reason: "unrecognized file type" };
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * matchGlobPattern — 简易 glob 模式匹配
 *
 * 支持的 glob 语法（覆盖 vext 用户常见需求）：
 *   - `*`  — 匹配路径段内的任意字符（不含 /）
 *   - `**` — 匹配任意层级的路径（含 /）
 *   - 字面量 — 精确匹配
 *
 * 不支持的高级语法：
 *   - `?`（单字符）、`[abc]`（字符集）、`{a,b}`（分支）
 *   - 这些在 dev 配置场景中极少使用，如需支持可后续扩展
 *
 * @param filePath 被匹配的文件路径（已规范化为 / 分隔符）
 * @param pattern glob 模式字符串
 * @returns 是否匹配
 */
export function matchGlobPattern(filePath: string, pattern: string): boolean {
  // 将 glob 模式转为正则表达式
  const regexStr = pattern
    // 先转义正则特殊字符（除了 * 和 ?）
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // ** → 匹配任意路径（含 /）
    .replace(/\*\*/g, "\0GLOBSTAR\0")
    // * → 匹配路径段内的任意字符（不含 /）
    .replace(/\*/g, "[^/]*")
    // 还原 **
    .replace(/\0GLOBSTAR\0/g, ".*");

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(filePath);
}

// ── 导出内置规则（供测试和调试使用）────────────────────────

/**
 * 获取内置冷重启模式列表的副本
 *
 * 仅供测试和调试使用，生产代码应使用 classifyChange() 函数。
 */
export function getColdPatterns(): readonly RegExp[] {
  return [...COLD_PATTERNS];
}

/**
 * 获取内置忽略模式列表的副本
 *
 * 仅供测试和调试使用，生产代码应使用 classifyChange() 函数。
 */
export function getIgnorePatterns(): readonly RegExp[] {
  return [...IGNORE_PATTERNS];
}
