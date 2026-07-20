import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedVextDocsConfig, VextCodeDocsDocument } from "../types.js";
import { loadComponentCodeDocs } from "./component-source.js";
import { loadMiddlewareCodeDocs } from "./middleware-source.js";
import { loadModelCodeDocs } from "./model-source.js";
import { loadPluginCodeDocs } from "./plugin-source.js";
import { loadServiceCodeDocs } from "./service-source.js";
import {
  loadConfigCodeDocs,
  loadLocaleCodeDocs,
  loadPreloadCodeDocs,
  loadStyleCodeDocs,
} from "./static-source.js";
import { loadUtilsCodeDocs } from "./utils-source.js";

export interface CodeDocsProviderOptions {
  rootDir?: string;
  srcDir?: string;
  modelsDir?: string;
  config: ResolvedVextDocsConfig;
}

export type CodeDocsProvider = () => Promise<VextCodeDocsDocument>;

export function createCodeDocsProvider(
  options: CodeDocsProviderOptions,
): CodeDocsProvider {
  if (options.config.code.scan !== "background") {
    return () => loadCodeDocs(options);
  }

  let cached: VextCodeDocsDocument | undefined;
  let pending: Promise<VextCodeDocsDocument> | undefined;
  const load = () => {
    pending = loadCodeDocs(options)
      .then((document) => {
        cached = document;
        return document;
      })
      .finally(() => {
        pending = undefined;
      });
    pending.catch(() => undefined);
    return pending;
  };

  load();
  return async () => {
    return cached ?? pending ?? load();
  };
}

export async function loadCodeDocs(
  options: CodeDocsProviderOptions,
): Promise<VextCodeDocsDocument> {
  const code = options.config.code;
  if (code.enabled === false) {
    return { items: [], generatedAt: new Date().toISOString() };
  }

  const srcDir = resolveCodeDocsSourceDir(options);
  const items = [
    ...(await loadServiceCodeDocs({ srcDir, source: code.services })),
    ...(await loadUtilsCodeDocs({ srcDir, source: code.utils })),
    ...(await loadModelCodeDocs({
      srcDir,
      modelsDir: options.modelsDir,
      source: code.models,
    })),
    ...(await loadComponentCodeDocs({
      srcDir,
      source: code.components,
    })),
    ...(await loadPluginCodeDocs({
      srcDir,
      source: code.plugins,
    })),
    ...(await loadMiddlewareCodeDocs({
      srcDir,
      source: code.middlewares,
    })),
    ...(await loadLocaleCodeDocs({
      rootDir: options.rootDir,
      srcDir,
      source: code.locales,
    })),
    ...(await loadConfigCodeDocs({
      rootDir: options.rootDir,
      srcDir,
      source: code.config,
    })),
    ...(await loadPreloadCodeDocs({
      rootDir: options.rootDir,
      srcDir,
      source: code.preload,
    })),
    ...(await loadStyleCodeDocs({
      rootDir: options.rootDir,
      srcDir,
      source: code.styles,
    })),
  ];

  return {
    items,
    generatedAt: new Date().toISOString(),
  };
}

function resolveCodeDocsSourceDir(options: CodeDocsProviderOptions): string {
  if (options.rootDir) {
    const sourceDir = join(options.rootDir, "src");
    if (existsSync(sourceDir)) {
      return sourceDir;
    }
  }
  return options.srcDir ?? join(options.rootDir ?? process.cwd(), "src");
}
