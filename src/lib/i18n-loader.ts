import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { importUserModule } from "./user-module-loader.js";
import { resolveModuleDefault } from "./interop.js";
import { scanLocaleSources } from "./i18n/catalog.js";
import { projectLocaleMessages, type LocaleMessages } from "./i18n/messages.js";
import type { VextLogger } from "../types/app.js";

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
export async function loadI18n(
  localesDir: string,
  logger: VextLogger,
  replaceMessages: (locales: LocaleMessages) => void,
  options: { rootDir?: string; compiled?: boolean } = {},
): Promise<string[]> {
  const locales = await readLocaleCatalog(localesDir, options);
  replaceMessages(locales);
  const loaded = Object.keys(locales).sort();
  if (loaded.length)
    logger.debug(`[vextjs] i18n candidate loaded: ${loaded.join(", ")}`);
  return loaded;
}
