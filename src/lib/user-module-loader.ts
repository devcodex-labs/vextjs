import { unlink, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

let compiledModuleSequence = 0;
const userModuleCache = new Map<string, Promise<Record<string, unknown>>>();

/** Import a user module while supporting TypeScript on every supported Node line. */
export function importUserModule(
  filePath: string,
): Promise<Record<string, unknown>> {
  const cached = userModuleCache.get(filePath);
  if (cached) return cached;

  const pending = loadUserModule(filePath);
  userModuleCache.set(filePath, pending);
  void pending.catch(() => userModuleCache.delete(filePath));
  return pending;
}

async function loadUserModule(
  filePath: string,
): Promise<Record<string, unknown>> {
  if (extname(filePath).toLowerCase() !== ".ts") {
    return (await import(pathToFileURL(filePath).href)) as Record<
      string,
      unknown
    >;
  }

  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [filePath],
    bundle: true,
    packages: "external",
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const output = result.outputFiles?.[0];
  if (!output) {
    throw new Error(
      `[vextjs] TypeScript module compilation produced no output: ${filePath}`,
    );
  }

  const sequence = ++compiledModuleSequence;
  const compiledPath = `${filePath.slice(0, -3)}.__vext_compiled__${process.pid}-${Date.now()}-${sequence}.mjs`;
  await writeFile(compiledPath, output.text, "utf8");

  try {
    return (await import(pathToFileURL(compiledPath).href)) as Record<
      string,
      unknown
    >;
  } finally {
    await unlink(compiledPath).catch(() => undefined);
  }
}
