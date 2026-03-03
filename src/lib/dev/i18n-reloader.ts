import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { createRequire } from "node:module";

// 在 ESM 环境中通过 createRequire 获取 CJS 的 require 函数。
// i18n-reloader 需要 require() 加载 .vext/dev/locales/ 下的 CJS 编译产物，
// 以及访问 require.cache 和 require.resolve 来管理模块缓存。
const esmRequire = createRequire(import.meta.url);

/**
 * i18n-reloader.ts — i18n 语言包热替换（Phase 2B）
 *
 * Soft Reload 时重新加载编译产物中的语言包文件，
 * 并通过 configureI18n 回调更新框架的 i18n 配置。
 *
 * 核心流程：
 *
 *   1. 检查 outDir/locales/ 目录是否存在
 *   2. 扫描目录下的所有 .js 文件（编译产物）
 *   3. 按文件名提取语言代码（如 zh-CN.js → 'zh-CN'）
 *   4. require() 每个语言文件（require.cache 已被 cache-invalidator 清除，
 *      这里会重新从磁盘加载新编译的 .js）
 *   5. 通过 configureI18n 回调将新的语言包注册到 schema-dsl
 *
 * 与 i18n-loader.ts 的区别：
 *
 *   | 对比项          | i18n-loader.ts（启动时）          | i18n-reloader.ts（热重载时）        |
 *   |-----------------|-----------------------------------|-------------------------------------|
 *   | 调用时机         | bootstrap 阶段（首次加载）         | soft reload 时（用户修改语言文件后） |
 *   | 加载方式         | ESM dynamic import（file:// URL） | CJS require（编译产物 .js）          |
 *   | 缓存处理         | 无需（首次加载）                   | require.cache 已被前置步骤清除       |
 *   | i18n 注册        | schemaAdapter.configure() 直接调用 | 通过 configureI18n 回调解耦           |
 *   | 子目录模式支持   | 仅平铺模式（模式 A）               | 仅平铺模式（模式 A）                |
 *
 * 安全保证：
 *
 *   - locales 目录不存在 → 静默跳过（返回空结果）
 *   - 语言文件 require 失败 → 跳过并打印警告（不阻塞重载流程）
 *   - 无有效语言文件 → 静默跳过（不调用 configureI18n）
 *   - configureI18n 回调失败 → 打印警告（不阻塞重载流程）
 *
 * @module lib/dev/i18n-reloader
 * @see 11b-soft-reload.md §6（i18n 热替换）
 * @see i18n-loader.ts（启动时语言包加载器）
 * @see 06b-error.md §1.7（多语言配置方式）
 * @see IMPLEMENTATION-PLAN.md 任务 2.2b
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * 错误消息映射类型
 *
 * 与 schema-dsl 的 ErrorMessages 类型兼容。
 * key: 错误 key（如 'user.not_found'）
 * value: { code: number, message: string } 或其他 schema-dsl 支持的格式
 */
export type ErrorMessages = Record<string, unknown>;

/**
 * i18n 配置回调函数类型
 *
 * 由调用方提供，用于将加载的语言包注册到 schema-dsl。
 * 通常封装了 schemaAdapter.configure({ i18n: locales }) 调用。
 *
 * 这样设计是为了解耦 i18n-reloader 与 schema-dsl 的直接依赖，
 * 便于单元测试和未来切换 i18n 实现。
 *
 * @param locales 语言代码 → 错误消息映射 的字典（如 { 'zh-CN': {...}, 'en-US': {...} }）
 */
export type ConfigureI18nFn = (locales: Record<string, ErrorMessages>) => void;

/**
 * 最小化的 Logger 接口（仅包含 i18n-reloader 需要的方法）
 */
export interface I18nReloaderLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * i18n 重载选项
 */
export interface ReloadLocalesOptions {
  /**
   * 编译产物目录（.vext/dev/ 的绝对路径）
   *
   * i18n-reloader 会在 outDir/locales/ 下查找语言文件。
   */
  outDir: string;

  /**
   * Logger 实例
   */
  logger: I18nReloaderLogger;

  /**
   * i18n 配置回调函数
   *
   * 加载完所有语言文件后，调用此函数将新语言包注册到 i18n 系统。
   * 如果不提供，则只加载文件但不注册（仅用于测试或手动注册场景）。
   */
  configureI18n?: ConfigureI18nFn;
}

/**
 * i18n 重载结果
 */
export interface I18nReloadResult {
  /** 成功加载的语言代码列表（如 ['zh-CN', 'en-US']） */
  loadedLocales: string[];

  /** 加载失败的语言文件列表（文件名） */
  failedFiles: string[];

  /** 是否成功注册到 i18n 系统 */
  configured: boolean;
}

// ── 常量 ────────────────────────────────────────────────────

/**
 * 语言代码格式校验正则
 *
 * 匹配标准的 BCP 47 语言标签格式，如：
 *   zh-CN, en-US, ja-JP, ko-KR, fr, de, pt-BR
 *
 * 简化版：只匹配 2-3 个字母的语言码 + 可选的 2-3 个字母/数字的区域码
 *
 * 与 i18n-loader.ts 中的 LOCALE_CODE_PATTERN 保持一致。
 */
const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/;

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * isLocaleFile — 判断文件名是否为有效的语言文件
 *
 * 条件：
 *   1. 以 .js 结尾（编译产物）
 *   2. 不是 .js.map（source map）
 *   3. 去掉扩展名后匹配语言代码格式
 *
 * @param filename 文件名（不含目录路径）
 * @returns 是否为有效的语言文件
 */
export function isLocaleFile(filename: string): boolean {
  if (!filename.endsWith(".js")) return false;
  if (filename.endsWith(".js.map")) return false;
  if (filename.endsWith(".d.ts")) return false;

  const code = filename.slice(0, -3); // 去掉 .js
  return LOCALE_CODE_PATTERN.test(code);
}

/**
 * extractLocaleCode — 从文件名中提取语言代码
 *
 * @param filename 文件名（如 'zh-CN.js'）
 * @returns 语言代码（如 'zh-CN'）
 */
export function extractLocaleCode(filename: string): string {
  return basename(filename, ".js");
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * reloadLocales — 重载 i18n 语言包
 *
 * 扫描 outDir/locales/ 目录，require() 每个语言文件，
 * 并通过 configureI18n 回调注册到 i18n 系统。
 *
 * require.cache 已在前面被 cache-invalidator 清除，
 * 这里 require() 会从磁盘重新加载最新编译产物。
 *
 * @param options 重载选项
 * @returns 重载结果
 */
export async function reloadLocales(
  options: ReloadLocalesOptions,
): Promise<I18nReloadResult> {
  const { outDir, logger, configureI18n } = options;
  const localesDir = join(outDir, "locales");

  const result: I18nReloadResult = {
    loadedLocales: [],
    failedFiles: [],
    configured: false,
  };

  // ── 1. 检查 locales 目录是否存在 ──────────────────────
  if (!existsSync(localesDir)) {
    logger.debug(
      "[hot-reload] locales directory not found, skipping i18n reload",
    );
    return result;
  }

  // ── 2. 读取目录内容 ──────────────────────────────────
  let files: string[];
  try {
    files = await readdir(localesDir);
  } catch (err) {
    logger.warn(
      `[hot-reload] failed to read locales directory: ${(err as Error).message}`,
    );
    return result;
  }

  // ── 3. 筛选语言文件 ──────────────────────────────────
  //
  // 按文件名提取语言代码：
  //   zh-CN.js → { code: 'zh-CN', file: 'zh-CN.js' }
  //   en-US.js → { code: 'en-US', file: 'en-US.js' }
  //   index.js → 跳过（不匹配语言代码格式）
  //
  const localeFiles: Array<{ code: string; file: string }> = [];
  const seenCodes = new Set<string>();

  for (const file of files) {
    if (!isLocaleFile(file)) {
      logger.debug(
        `[hot-reload] skipping non-locale file in locales/: ${file}`,
      );
      continue;
    }

    const code = extractLocaleCode(file);

    // 去重（同一语言代码只取第一个）
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);

    localeFiles.push({ code, file });
  }

  // ── 4. 无语言文件 → 静默跳过 ─────────────────────────
  if (localeFiles.length === 0) {
    logger.debug(
      "[hot-reload] no locale files found in locales/, skipping i18n reload",
    );
    return result;
  }

  // ── 5. require 每个语言文件 ───────────────────────────
  //
  // require.cache 已在 cache-invalidator 中被清除，
  // 这里 require() 会从 .vext/dev/locales/ 读取新编译的 .js。
  //
  // 使用 CJS require（而非 ESM import）的原因：
  //   - 编译产物是 CJS 格式（esbuild 输出）
  //   - require() 是同步的，更可控
  //   - require.cache 清除后 require() 保证加载最新内容
  //
  const locales: Record<string, ErrorMessages> = {};

  for (const { code, file } of localeFiles) {
    const fullPath = join(localesDir, file);

    try {
      // 清除可能残留的缓存条目（防御性，cache-invalidator 应已处理）
      const resolvedPath = resolveRequirePath(fullPath);
      if (resolvedPath && esmRequire.cache[resolvedPath]) {
        delete esmRequire.cache[resolvedPath];
      }

      // require 最新编译产物
      const mod = esmRequire(fullPath);
      const messages = mod.default !== undefined ? mod.default : mod;

      if (typeof messages !== "object" || messages === null) {
        logger.warn(
          `[hot-reload] locales/${file}: invalid export (expected object), skipping`,
        );
        result.failedFiles.push(file);
        continue;
      }

      locales[code] = messages as ErrorMessages;
      result.loadedLocales.push(code);
    } catch (err) {
      // require 失败不阻塞重载流程
      logger.warn(
        `[hot-reload] failed to load locale file: locales/${file}: ${(err as Error).message}`,
      );
      result.failedFiles.push(file);
    }
  }

  // ── 6. 注册到 i18n 系统 ──────────────────────────────
  //
  // 通过 configureI18n 回调将新的语言包注册到 schema-dsl。
  // configureI18n 回调失败不阻塞重载流程。
  //
  if (result.loadedLocales.length > 0 && configureI18n) {
    try {
      configureI18n(locales);
      result.configured = true;

      logger.info(
        `[hot-reload] i18n reloaded: ${result.loadedLocales.join(", ")}`,
      );
    } catch (err) {
      logger.warn(
        `[hot-reload] failed to configure i18n: ${(err as Error).message}`,
      );
      result.configured = false;
    }
  } else if (result.loadedLocales.length > 0) {
    // 无 configureI18n 回调但加载了语言文件
    // 这种情况通常用于测试
    logger.debug(
      `[hot-reload] i18n loaded ${result.loadedLocales.length} locale(s) (no configureI18n callback)`,
    );
  }

  return result;
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * resolveRequirePath — 安全地解析 require 路径
 *
 * 封装 require.resolve，失败时返回 null（不抛出异常）。
 *
 * @param filePath 文件路径
 * @returns 解析后的绝对路径，失败时返回 null
 */
function resolveRequirePath(filePath: string): string | null {
  try {
    return esmRequire.resolve(filePath);
  } catch {
    return null;
  }
}

// ── 便捷函数 ────────────────────────────────────────────────

/**
 * shouldReloadLocales — 判断变更文件列表中是否包含 locale 文件
 *
 * 用于 soft reload 主流程中快速判断是否需要执行 i18n 重载。
 * 避免在无 locale 变更时执行不必要的 reloadLocales。
 *
 * @param filePaths 变更文件的相对路径列表（如 ['routes/user.ts', 'locales/zh-CN.ts']）
 * @returns 是否包含 locale 文件
 */
export function shouldReloadLocales(filePaths: string[]): boolean {
  return filePaths.some((f) => {
    // 规范化路径分隔符（兼容 Windows）
    const normalized = f.split(/[/\\]/).join("/");
    return normalized.includes("locales/");
  });
}

/**
 * createI18nReloader — 创建一个预配置的 i18n 重载函数
 *
 * 将 logger 和 configureI18n 绑定后，返回一个只需 outDir 的
 * 简化重载函数。适合在 soft reload 主流程中使用。
 *
 * @param logger Logger 实例
 * @param configureI18n i18n 配置回调
 * @returns 简化的 i18n 重载函数
 *
 * @example
 * ```ts
 * // 初始化时
 * const reloadI18n = createI18nReloader(app.logger, (locales) => {
 *   schemaAdapter.configure({ i18n: locales })
 * })
 *
 * // soft reload 时
 * if (shouldReloadLocales(filePaths)) {
 *   await reloadI18n(outDir)
 * }
 * ```
 */
export function createI18nReloader(
  logger: I18nReloaderLogger,
  configureI18n?: ConfigureI18nFn,
): (outDir: string) => Promise<I18nReloadResult> {
  return (outDir: string) =>
    reloadLocales({
      outDir,
      logger,
      configureI18n,
    });
}
