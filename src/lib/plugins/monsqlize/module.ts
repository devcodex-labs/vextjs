import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);

export type MonSQLizeModule = Record<string, unknown> & {
  default?: unknown;
  MonSQLize?: unknown;
  Model?: unknown;
};

function isVitestRuntime(): boolean {
  return (
    process.env.VITEST === "true" ||
    process.env.VITEST_WORKER_ID !== undefined
  );
}

export async function loadMonSQLizeModule(): Promise<MonSQLizeModule> {
  if (!isVitestRuntime()) {
    try {
      return requireFromHere("monsqlize") as MonSQLizeModule;
    } catch {
      // Fall back to dynamic import so missing-package errors keep the native shape.
    }
  }

  return (await import("monsqlize")) as MonSQLizeModule;
}

export function resolveMonSQLizeClass(mod: MonSQLizeModule): unknown {
  return mod.default ?? mod.MonSQLize ?? mod;
}

export async function loadMonSQLizeClass(): Promise<any> {
  const mod = await loadMonSQLizeModule();
  return resolveMonSQLizeClass(mod);
}

export async function loadMonSQLizeModelClass(): Promise<any> {
  const mod = await loadMonSQLizeModule();
  const MonSQLizeClass = resolveMonSQLizeClass(mod) as Record<string, unknown>;
  return MonSQLizeClass.Model ?? mod.Model;
}
