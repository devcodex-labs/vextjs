import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { moduleResolve } from "import-meta-resolve";

interface ConsumerPackage {
  rootDir: string;
  manifest: Record<string, unknown>;
}

/** 从业务消费者解析模块，不执行模块，也不回退到框架自己的依赖副本。 */
export function resolveConsumerModule(
  rootDir: string,
  specifier: string,
): string {
  const parent = pathToFileURL(join(resolve(rootDir), "package.json"));
  return moduleResolve(specifier, parent, new Set(["node", "import"]), false)
    .href;
}

/** package.json 是工具元数据；即使未作为 exports 暴露也可只读定位。 */
export function resolveConsumerPackage(
  rootDir: string,
  packageName: string,
): ConsumerPackage {
  if (
    !/^(?:@[^/\\]+\/)?[^/\\]+$/.test(packageName) ||
    packageName.startsWith(".")
  ) {
    throw new Error(`[vextjs] Invalid package name: ${packageName}`);
  }
  const consumer = createRequire(join(resolve(rootDir), "package.json"));
  const searchPaths = consumer.resolve.paths(packageName) ?? [];
  for (const searchPath of searchPaths) {
    const packageRoot = join(searchPath, packageName);
    const manifestPath = join(packageRoot, "package.json");
    if (!existsSync(manifestPath)) continue;
    // 最近的包存在但损坏时应直接报错，不能静默选中另一个版本。
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    return { rootDir: realpathSync(packageRoot), manifest };
  }
  // 包自身执行 CLI 时可能没有 node_modules/vextjs 链接；按 Node self-reference 解析。
  try {
    let directory = dirname(
      fileURLToPath(resolveConsumerModule(rootDir, packageName)),
    );
    while (true) {
      const manifestPath = join(directory, "package.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(
          readFileSync(manifestPath, "utf8"),
        ) as Record<string, unknown>;
        if (manifest.name === packageName)
          return { rootDir: realpathSync(directory), manifest };
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch {
    // 下方给出消费者与依赖的明确诊断。
  }
  throw new Error(
    `[vextjs] Cannot resolve package "${packageName}" from ${rootDir}. Install this consumer's dependencies first.`,
  );
}

export function resolveFrameworkEntry(
  rootDir: string,
  entry: "bootstrap" | "dev",
): string {
  const pkg = resolveConsumerPackage(rootDir, "vextjs");
  const relative =
    entry === "bootstrap"
      ? "dist/lib/bootstrap.js"
      : "dist/lib/dev/dev-entry.js";
  const filename = join(pkg.rootDir, relative);
  if (!existsSync(filename) || !statSync(filename).isFile()) {
    throw new Error(
      `[vextjs] Framework entry ${filename} is missing. Build or reinstall the vextjs package resolved from ${rootDir}.`,
    );
  }
  return realpathSync(filename);
}
