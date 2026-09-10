import { join, basename, extname } from "node:path";
import { readLocaleCatalog, LocaleCatalogError } from "../i18n-loader.js";
import { canonicalLocale } from "../i18n/catalog.js";

/** 启动与重载共用目录和key投影；候选失败时不调用替换回调。 */

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
 * 由调用方提供，将完整候选替换到当前 app 的 schema runtime。
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
  /** 已解析目录覆盖；默认使用 outDir/locales。 */
  localesDir?: string;
  rootDir?: string;
  compiled?: boolean;

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

export function isLocaleFile(filename: string): boolean {
  const extension = extname(filename);
  return (
    [".js", ".mjs", ".cjs", ".json"].includes(extension) &&
    canonicalLocale(basename(filename, extension)) !== undefined
  );
}

/**
 * extractLocaleCode — 从文件名中提取语言代码
 *
 * @param filename 文件名（如 'zh-CN.js'）
 * @returns 语言代码（如 'zh-CN'）
 */
export function extractLocaleCode(filename: string): string {
  const value = basename(filename, extname(filename));
  return canonicalLocale(value) ?? value;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * reloadLocales — 重载 i18n 语言包
 *
 * 扫描 outDir/locales/ 下的扁平及模块化语言文件；JSON 直接读取，
 * 编译后的模块按运行时加载。整批校验成功后才调用替换回调。
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
  try {
    const locales = await readLocaleCatalog(
      options.localesDir ?? join(outDir, "locales"),
      { rootDir: options.rootDir, compiled: options.compiled ?? true },
    );
    // 空字典也必须提交，删除最后一个文件时不能保留已删除的消息。
    configureI18n?.(locales);
    const loadedLocales = Object.keys(locales).sort();
    logger.info(
      `[hot-reload] i18n reloaded: ${loadedLocales.join(", ") || "(empty)"}`,
    );
    return {
      loadedLocales,
      failedFiles: [],
      configured: configureI18n !== undefined,
    };
  } catch (error) {
    logger.warn(
      `[hot-reload] i18n candidate rejected; previous messages retained: ${String(error)}`,
    );
    return {
      loadedLocales: [],
      failedFiles: [
        error instanceof LocaleCatalogError ? error.file : "locales",
      ],
      configured: false,
    };
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
    return normalized.split("/").includes("locales");
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
 * const reloadI18n = createI18nReloader(app.logger, appRuntime.replaceMessages)
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
