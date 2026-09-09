import path from "node:path";
import { assertRealPathInside, isPathInside } from "../path-boundary.js";

/** 仅接收已解析的配置值；不加载配置模块，也不创建目录。 */
export interface FrontendLayoutInput {
  root?: string;
  pages?: { dir?: string; document?: string; errorDir?: string };
  componentsDir?: string;
  styles?: { entry?: string };
  assetsDir?: string;
  publicDir?: string;
  entry?: string;
  indexHtml?: string;
  outDir?: string;
  alias?: Record<string, string>;
}

export interface ResolvedFrontendLayout {
  root: string;
  pagesDir: string;
  document: string;
  errorDir: string;
  componentsDir: string;
  stylesEntry: string;
  assetsDir: string;
  publicDir: string;
  entry: string;
  indexHtml: string;
  outDir: string;
  alias: Record<string, string>;
}

/** 前端根外的显式组件/资源目录也属于浏览器源；任意 alias 不自动改变目录角色。 */
export function frontendSourceDirectories(
  layout: ResolvedFrontendLayout,
): string[] {
  return [
    ...new Set([
      layout.root,
      layout.pagesDir,
      layout.componentsDir,
      layout.assetsDir,
      path.dirname(layout.stylesEntry),
      layout.publicDir,
      layout.errorDir,
    ]),
  ];
}

export function frontendSourceFiles(layout: ResolvedFrontendLayout): string[] {
  return [
    ...new Set([
      layout.entry,
      layout.document,
      layout.indexHtml,
      layout.stylesEntry,
    ]),
  ];
}

/** child→parent 只投影目录事实，不发送完整业务配置或再次求值 provider。 */
export interface FrontendWatchLayout {
  frontendDirectories: string[];
  frontendFiles: string[];
}

export function createFrontendWatchLayout(
  projectRoot: string,
  input?: FrontendLayoutInput,
): FrontendWatchLayout {
  const layout = resolveFrontendLayout(projectRoot, input, "development");
  const relative = (value: string): string =>
    path.relative(projectRoot, value).replaceAll("\\", "/");
  return {
    frontendDirectories: frontendSourceDirectories(layout)
      .filter(
        (directory) =>
          path.resolve(directory) !== path.resolve(projectRoot, "src") &&
          path.resolve(directory) !== path.resolve(projectRoot),
      )
      .map(relative),
    frontendFiles: frontendSourceFiles(layout).map(relative),
  };
}

export function isFrontendWatchLayout(
  value: unknown,
): value is FrontendWatchLayout {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [record.frontendDirectories, record.frontendFiles].every(
    (paths) =>
      Array.isArray(paths) &&
      paths.length <= 20 &&
      paths.every(
        (item) =>
          typeof item === "string" &&
          item.length > 0 &&
          item.length <= 4096 &&
          !path.posix.isAbsolute(item) &&
          !path.win32.isAbsolute(item) &&
          !/^[a-z]:/iu.test(item) &&
          !item.includes("\0") &&
          !item.includes("\\") &&
          item
            .split("/")
            .every((part) => part !== ".." && part !== "." && part !== ""),
      ),
  );
}

export function resolveProjectRolePath(
  projectRoot: string,
  baseDir: string,
  value: string,
  label: string,
  allowRoot = false,
): string {
  const resolved = path.resolve(baseDir, value);
  if (!isPathInside(projectRoot, resolved, allowRoot)) {
    throw new Error(`[vextjs] ${label} must resolve inside the project root.`);
  }
  assertRealPathInside(projectRoot, resolved, label, allowRoot);
  return resolved;
}

/** models.dir 相对当前源码根；编译模式传入编译输出根，避免 HMR 猜目录。 */
export function resolveModelsDirectory(
  sourceBase: string,
  directory = "models",
): string {
  return resolveProjectRolePath(
    sourceBase,
    sourceBase,
    directory,
    "models.dir",
    true,
  );
}

export function resolveFrontendLayout(
  projectRoot: string,
  input: FrontendLayoutInput = {},
  mode: "development" | "production" = "production",
): ResolvedFrontendLayout {
  const projectPath = (value: string, name: string): string =>
    resolveProjectRolePath(
      projectRoot,
      projectRoot,
      value,
      `config.frontend.${name}`,
    );
  const root = projectPath(input.root ?? "src/frontend", "root");
  const frontendPath = (value: string, name: string): string =>
    resolveProjectRolePath(projectRoot, root, value, `config.frontend.${name}`);
  const pagesDir = frontendPath(input.pages?.dir ?? "pages", "pages.dir");
  // 显式 document/errorDir 保持 frontend.root 相对语义，默认值跟随 pages.dir。
  const document = frontendPath(
    input.pages?.document ?? path.join(pagesDir, "_document.html"),
    "pages.document",
  );
  const errorDir = frontendPath(
    input.pages?.errorDir ?? path.join(pagesDir, "error"),
    "pages.errorDir",
  );
  const componentsDir = frontendPath(
    input.componentsDir ?? "components",
    "componentsDir",
  );
  const stylesEntry = frontendPath(
    input.styles?.entry ?? "styles/index.css",
    "styles.entry",
  );
  const assetsDir = frontendPath(input.assetsDir ?? "assets", "assetsDir");
  const alias: Record<string, string> = {
    "@frontend": root,
    "@pages": pagesDir,
    "@components": componentsDir,
    "@styles": path.dirname(stylesEntry),
    "@assets": assetsDir,
  };
  for (const [name, value] of Object.entries(input.alias ?? {})) {
    alias[name] = frontendPath(value, `alias.${name}`);
  }
  return {
    root,
    pagesDir,
    document,
    errorDir,
    componentsDir,
    stylesEntry,
    assetsDir,
    alias,
    publicDir: projectPath(input.publicDir ?? "public", "publicDir"),
    entry: projectPath(
      input.entry ?? ".vext/generated/frontend/browser-entry.tsx",
      "entry",
    ),
    indexHtml: projectPath(input.indexHtml ?? document, "indexHtml"),
    outDir: projectPath(
      input.outDir ?? (mode === "development" ? ".vext/client" : "dist/client"),
      "outDir",
    ),
  };
}
