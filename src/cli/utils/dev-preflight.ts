import { existsSync } from "node:fs";
import { join, relative } from "node:path";

import { loadTsMorph } from "../../tooling/shared/lazy-ts-morph.js";
import { runTypegen } from "../../tooling/typegen/index.js";

export interface DevPreflightOptions {
  rootDir: string;
  language: "ts" | "js";
  reason: string;
}

export interface DevPreflightResult {
  ok: boolean;
  typegenOk: boolean;
  tsOk: boolean;
}

interface TsDiagnosticsResult {
  ok: boolean;
  errorCount: number;
  formatted?: string;
}

export async function runDevPreflight(
  options: DevPreflightOptions,
): Promise<DevPreflightResult> {
  const { rootDir, language, reason } = options;

  const typegenResult = await runTypegen({
    rootDir,
    generateServices: true,
    generateAppExtensions: true,
  });

  logTypegenResult(rootDir, typegenResult);

  const tsDiagnostics =
    language === "ts"
      ? await runTypeScriptDiagnostics(rootDir)
      : { ok: true, errorCount: 0 };

  if (!typegenResult.ok) {
    console.error(`[vext dev] typegen reported blocking issues during ${reason}.`);
  }

  if (!tsDiagnostics.ok) {
    console.error(
      `[vext dev] TypeScript reported ${tsDiagnostics.errorCount} blocking error(s) during ${reason}.`,
    );
    if (tsDiagnostics.formatted) {
      console.error(tsDiagnostics.formatted);
    }
  }

  return {
    ok: typegenResult.ok && tsDiagnostics.ok,
    typegenOk: typegenResult.ok,
    tsOk: tsDiagnostics.ok,
  };
}

function logTypegenResult(
  rootDir: string,
  result: Awaited<ReturnType<typeof runTypegen>>,
): void {
  for (const file of result.files) {
    if (file.status === "written") {
      console.log(
        `[vext dev] generated ${toRelativePath(rootDir, file.filePath)}`,
      );
    }
  }

  if (result.manifest?.status === "written") {
    console.log(
      `[vext dev] generated ${toRelativePath(rootDir, result.manifest.filePath)}`,
    );
  }

  for (const warning of result.warnings) {
    console.warn(`[vext dev] typegen warning: ${warning}`);
  }

  for (const diagnostic of result.diagnostics) {
    const logger = diagnostic.level === "error" ? console.error : console.log;
    logger(`[vext dev] typegen ${diagnostic.level}: ${diagnostic.message}`);
  }
}

async function runTypeScriptDiagnostics(
  rootDir: string,
): Promise<TsDiagnosticsResult> {
  const tsconfigPath = join(rootDir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    return { ok: true, errorCount: 0 };
  }

  const tsMorph = await loadTsMorph();
  const project = new tsMorph.Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: false,
  });

  const diagnostics = project
    .getPreEmitDiagnostics()
    .filter(
      (diagnostic) =>
        diagnostic.getCategory() === tsMorph.ts.DiagnosticCategory.Error,
    );

  if (diagnostics.length === 0) {
    return { ok: true, errorCount: 0 };
  }

  return {
    ok: false,
    errorCount: diagnostics.length,
    formatted: project.formatDiagnosticsWithColorAndContext(diagnostics, {
      newLineChar: "\n",
    }),
  };
}

function toRelativePath(rootDir: string, filePath: string): string {
  return relative(rootDir, filePath).replace(/\\/g, "/");
}
