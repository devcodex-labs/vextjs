import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { importUserModule } from "./user-module-loader.js";
import { resolveModuleDefault } from "./interop.js";
import { scanLocaleSources } from "./i18n/catalog.js";
import { projectLocaleMessages, type LocaleMessages } from "./i18n/messages.js";
import type { VextApp } from "../types/app.js";
import { getAppSchemaRuntime } from "./i18n/app-runtime.js";

const localeRequire = createRequire(import.meta.url);

/**
 * 同时读取扁平和模块化locale。完整候选通过路径/key冲突校验后一次提交；
 * 错误阻止本次替换，不将半套字典注册为成功。
 */
export class LocaleCatalogError extends Error {
  constructor(
    readonly file: string,
    cause: unknown,
  ) {
    super(
      `[vextjs] Failed to load locale ${file}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

export async function readLocaleCatalog(
  localesDir: string,
  options: { rootDir?: string; compiled?: boolean } = {},
): Promise<LocaleMessages> {
  const sources = scanLocaleSources(localesDir);
  const loaded = [];
  for (const source of sources) {
    try {
      let messages: unknown;
      if (path.extname(source.absolutePath) === ".json") {
        messages = JSON.parse(
          readFileSync(source.absolutePath, "utf8").replace(/^\uFEFF/u, ""),
        );
      } else if (options.compiled) {
        const resolved = localeRequire.resolve(source.absolutePath);
        delete localeRequire.cache[resolved];
        const mod: unknown = localeRequire(resolved);
        messages =
          mod && typeof mod === "object" && "default" in mod
            ? resolveModuleDefault(mod as Record<string, unknown>)
            : mod;
      } else {
        messages = resolveModuleDefault(
          await importUserModule(
            source.absolutePath,
            options.rootDir ?? localesDir,
            { cache: false, readRoot: localesDir },
          ),
        );
      }
      if (!messages || typeof messages !== "object" || Array.isArray(messages))
        throw new Error("invalid export: expected a locale dictionary object");
      loaded.push({ ...source, messages });
    } catch (cause) {
      throw new LocaleCatalogError(source.file, cause);
    }
  }
  return projectLocaleMessages(loaded);
}
/**
 * 将指定目录的完整消息集合加载到一个框架创建的app，应用之间互不影响。
 * 通常由启动流程根据config.locale.directory调用；脚本字典会执行模块代码。
 * @param app createApp或createTestApp创建的应用
 * @param localesDir 明确选定的locale目录
 * @param options 源模块解析根及是否读取编译产物
 * @returns 已加载的规范化语言名；缺目录返回[]并清空该app的目录消息
 * @throws 目录、模块或消息校验失败时抛错，保留该app此前的消息
 */
export async function loadI18n(
  app: VextApp,
  localesDir: string,
  options: { rootDir?: string; compiled?: boolean } = {},
): Promise<string[]> {
  const runtime = getAppSchemaRuntime(app);
  const locales = await readLocaleCatalog(localesDir, options);
  runtime.replaceMessages(locales);
  const loaded = Object.keys(locales).sort();
  if (loaded.length)
    app.logger.debug(`[vextjs] i18n candidate loaded: ${loaded.join(", ")}`);
  return loaded;
}
