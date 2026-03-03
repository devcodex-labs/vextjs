import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { schemaAdapter } from "./schema-adapter.js";
import { resolveModuleDefault } from "./interop.js";
import type { ErrorMessages } from "./schema-adapter.js";
import type { VextLogger } from "../types/app.js";

/**
 * i18n-loader.ts — 国际化语言包自动加载器
 *
 * 框架启动时（bootstrap 步骤 ①+）自动扫描用户项目的 src/locales/ 目录，
 * 按文件名识别语言代码，动态导入语言文件，并通过 schemaAdapter.configure()
 * 注册到 schema-dsl 的 i18n 系统。
 *
 * 用户只需按约定在 src/locales/ 目录放置语言文件，无需编写任何 plugin 或中间件。
 *
 * 目录结构约定（模式 A：平铺文件，默认）：
 *   src/locales/
 *   ├── zh-CN.ts         # export default { 'key': { code, message }, ... }
 *   ├── en-US.ts         # 同上，code 必须与 zh-CN 一致
 *   ├── ja-JP.ts         # 可选，按需添加
 *   └── ...
 *
 * 子目录模式（模式 B：schema-dsl ≥ v1.2.3，多人协作）：
 *   src/locales/
 *   ├── core/            # 公共 code 段（框架层维护）
 *   │   ├── zh-CN.js
 *   │   └── en-US.js
 *   ├── account/         # 账户模块 code 段（开发者A）
 *   │   ├── zh-CN.js
 *   │   └── en-US.js
 *   └── order/           # 订单模块 code 段（开发者B）
 *       ├── zh-CN.js
 *       └── en-US.js
 *
 *   子目录模式不经过本 loader（本 loader 仅扫描平铺文件），
 *   而是通过插件直接传路径给 dsl.config({ i18n: path })，
 *   由 schema-dsl 内置的递归扫描自动合并同语言文件。
 *   详见 06b-error.md §1.7.1 模式 B。
 *
 *   注意：schema-dsl 内置扫描仅支持 .js/.json，不支持 .ts。
 *   如需 .ts + 子目录，建议编译后运行或在子目录中使用 .js 格式。
 *
 * 文件名约定：
 *   - 文件名即语言代码（去掉扩展名）：zh-CN.ts → 'zh-CN'
 *   - 支持的扩展名：.ts / .js / .mjs / .cjs
 *   - 忽略非语言文件（如 index.ts、README.md 等非标准语言代码格式的文件名）
 *
 * 语言文件格式：
 *   ```typescript
 *   // src/locales/zh-CN.ts
 *   export default {
 *     'user.not_found':         { code: 40001, message: '用户不存在' },
 *     'balance.insufficient':   { code: 20001, message: '余额不足，当前余额 {{balance}}' },
 *     'validate.required':      { code: 422,   message: '{{#field}} 不能为空' },
 *   }
 *   ```
 *
 * 与 schema-dsl 的关系：
 *   通过 schemaAdapter.configure({ i18n: { locales: { ... } } }) 注册语言包。
 *   schema-dsl 内部使用 dsl.config() 管理 i18n 配置。
 *   注册后，I18nError.create('user.not_found', 'zh-CN') 即可获取翻译后的消息。
 *   schema-dsl v1.2.3+ 支持 dsl.config({ i18n: path }) 自动递归扫描子目录，
 *   同语言文件自动合并，支持 strict 模式检测 key 冲突。
 *
 * 与 defaultThrow 的关系：
 *   app.throw(404, 'user.not_found') 内部调用 schemaAdapter.createI18nError()，
 *   后者从已注册的语言包中查找 'user.not_found' key，
 *   结合 requestContext 中的 locale（由中间件从 Accept-Language 写入），
 *   返回翻译后的消息。
 *
 * 错误处理：
 *   - locales 目录不存在 → 静默跳过（零配置场景，不报错）
 *   - 语言文件无 default export → 跳过并打印警告
 *   - 语言文件 import 失败 → 跳过并打印警告（不阻塞启动）
 *   - locales 目录为空 → 静默跳过
 *
 * @module lib/i18n-loader
 * @see IMPLEMENTATION-PLAN.md 任务 1.17
 * @see 06b-error.md §1.7（多语言配置方式）
 * @see 06b-error.md §1.7.1（框架内置行为）
 */

/**
 * 支持的语言文件扩展名（按优先级排列）
 *
 * 当存在同名不同扩展名的文件时，按此优先级选取第一个。
 * 例如 zh-CN.ts 和 zh-CN.js 同时存在时，优先使用 .ts。
 */
const LOCALE_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"];

/**
 * 语言代码格式校验正则
 *
 * 匹配标准的 BCP 47 语言标签格式，如：
 *   zh-CN, en-US, ja-JP, ko-KR, fr, de, pt-BR
 *
 * 简化版：只匹配 2-3 个字母的语言码 + 可选的 2-3 个字母/数字的区域码
 */
const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/;

/**
 * loadI18n — 加载国际化语言包
 *
 * 在 bootstrap 阶段调用，扫描 localesDir 下的语言文件，
 * 动态导入并注册到 schema-dsl。
 *
 * @param localesDir  语言文件目录的绝对路径（通常为 path.join(rootDir, 'src/locales')）
 * @param logger      框架 logger 实例（用于日志输出）
 * @returns 加载的语言代码列表（如 ['zh-CN', 'en-US']），目录不存在或为空时返回空数组
 *
 * @example
 * ```typescript
 * // bootstrap.ts 内部
 * const localesDir = path.join(rootDir, 'src/locales')
 * const loadedLocales = await loadI18n(localesDir, app.logger)
 * if (loadedLocales.length > 0) {
 *   app.logger.info(`[vextjs] i18n loaded: ${loadedLocales.join(', ')}`)
 * }
 * ```
 */
export async function loadI18n(
  localesDir: string,
  logger: VextLogger,
): Promise<string[]> {
  // ── 目录不存在 → 静默跳过（零配置场景）────────────────────
  if (!existsSync(localesDir)) {
    return [];
  }

  // ── 读取目录内容 ──────────────────────────────────────────
  let files: string[];
  try {
    files = await readdir(localesDir);
  } catch (err) {
    logger.warn(
      { error: (err as Error).message },
      "[vextjs] Failed to read locales directory, skipping i18n loading",
    );
    return [];
  }

  // ── 筛选语言文件 ──────────────────────────────────────────
  //
  // 按文件名提取语言代码：
  //   zh-CN.ts → { code: 'zh-CN', file: 'zh-CN.ts' }
  //   en-US.js → { code: 'en-US', file: 'en-US.js' }
  //   index.ts → 跳过（不匹配语言代码格式）
  //   README.md → 跳过（不支持的扩展名）
  //
  const localeFiles: Array<{ code: string; file: string }> = [];
  const seenCodes = new Set<string>();

  for (const file of files) {
    // 查找匹配的扩展名
    const ext = LOCALE_EXTENSIONS.find((e) => file.endsWith(e));
    if (!ext) continue;

    // 提取语言代码（去掉扩展名）
    const code = file.slice(0, -ext.length);

    // 校验语言代码格式
    if (!LOCALE_CODE_PATTERN.test(code)) {
      logger.debug(`[vextjs] Skipping non-locale file in locales/: ${file}`);
      continue;
    }

    // 去重（同一语言代码只取第一个匹配的扩展名）
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);

    localeFiles.push({ code, file });
  }

  // ── 无语言文件 → 静默跳过 ──────────────────────────────────
  if (localeFiles.length === 0) {
    return [];
  }

  // ── 动态导入语言文件 ──────────────────────────────────────
  //
  // 使用 pathToFileURL 将绝对路径转为 file:// URL，
  // 确保 Windows 路径（如 E:\MySelf\...）兼容 ESM 动态 import()。
  //
  const locales: Record<string, ErrorMessages> = {};
  const loadedCodes: string[] = [];

  for (const { code, file } of localeFiles) {
    const fullPath = join(localesDir, file);

    try {
      const fileUrl = pathToFileURL(fullPath).href;
      const mod = await import(fileUrl);

      // 检查 default export（处理 CJS interop double default）
      const defaultExport = resolveModuleDefault<ErrorMessages>(mod);

      if (!defaultExport || typeof defaultExport !== "object") {
        logger.warn(
          `[vextjs] locales/${file}: no valid default export (expected object), skipping`,
        );
        continue;
      }

      locales[code] = defaultExport;
      loadedCodes.push(code);
    } catch (err) {
      // import 失败不阻塞启动，打印警告
      logger.warn(
        { error: (err as Error).message },
        `[vextjs] Failed to load locale file: locales/${file}, skipping`,
      );
    }
  }

  // ── 注册到 schema-dsl ────────────────────────────────────
  //
  // 通过 schemaAdapter.configure() 调用 dsl.config({ i18n })。
  // schema-dsl 内部会合并已有的 i18n 配置。
  //
  if (loadedCodes.length > 0) {
    try {
      // dsl.config() 的 i18n 参数类型为 I18nConfig：
      //   string | Record<string, ErrorMessages> | { localesPath: string }
      // 直接传 Record<string, ErrorMessages> 对象即可。
      // 也可以使用兼容的 locales 字段：dsl.config({ locales: {...} })
      schemaAdapter.configure({
        i18n: locales,
      });
    } catch (err) {
      // configure 失败不应阻塞启动
      logger.warn(
        { error: (err as Error).message },
        "[vextjs] Failed to configure schema-dsl i18n, locale support may not work",
      );
    }
  }

  return loadedCodes;
}
