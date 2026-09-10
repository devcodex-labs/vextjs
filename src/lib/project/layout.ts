import path from "node:path";
import { assertRealPathInside, isPathInside } from "../path-boundary.js";

/** 仅接收已解析的配置值；不加载配置模块，也不创建目录。 */
export interface FrontendLayoutInput {
  enabled?: boolean;
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

export interface BackendWatchDirectory {
  path: string;
  action: "soft" | "cold";
}

export interface ProjectWatchLayout extends FrontendWatchLayout {
  backendDirectories: BackendWatchDirectory[];
}

/** 只从已求值配置投影读取目录；外部模块用进程重启刷新原生ESM/CJS依赖缓存。 */
export function createProjectWatchLayout(
  projectRoot: string,
  input: {
    frontend?: FrontendLayoutInput;
    localeDirectory?: string;
    modelsDirectory?: string;
  },
): ProjectWatchLayout {
  const src = path.resolve(projectRoot, "src");
  const backendDirectories = [
    resolveLocaleDirectory(projectRoot, src, input.localeDirectory).directory,
    resolveModelsDirectory(src, input.modelsDirectory, projectRoot),
  ].map((directory) => ({
    path: directory,
    action: isPathInside(src, directory, true)
      ? ("soft" as const)
      : ("cold" as const),
  }));
  return {
    ...createFrontendWatchLayout(projectRoot, input.frontend),
    backendDirectories,
  };
}

export function isProjectWatchLayout(
  value: unknown,
): value is ProjectWatchLayout {
  if (!isFrontendWatchLayout(value)) return false;
  const directories = (value as unknown as Record<string, unknown>)
    .backendDirectories;
  return (
    Array.isArray(directories) &&
    directories.length <= 20 &&
    directories.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.path === "string" &&
        item.path.length <= 4096 &&
        !item.path.includes("\0") &&
        path.isAbsolute(item.path) &&
        path.resolve(item.path) === item.path &&
        (item.action === "cold" || item.action === "soft"),
    )
  );
}

export function createFrontendWatchLayout(
  projectRoot: string,
  input?: FrontendLayoutInput,
): FrontendWatchLayout {
  if (input?.enabled !== true)
    return { frontendDirectories: [], frontendFiles: [] };
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
  projectRoot?: string,
): string {
  // 用户显式配置的是读取根；不把此路径注册成输出或允许清理的目录。
  if (!projectRoot) return path.resolve(sourceBase, directory);
  const source = path.join(projectRoot, "src");
  const configured = path.resolve(source, directory);
  return isPathInside(source, configured, true)
    ? path.resolve(sourceBase, path.relative(source, configured))
    : configured;
}

/** locale.directory 相对服务根；源码内目录随编译根映射，显式外部目录只读。 */
export function resolveLocaleDirectory(
  projectRoot: string,
  sourceBase: string,
  directory?: string,
): { directory: string; compiled: boolean } {
  const source = path.join(projectRoot, "src");
  const configured = path.resolve(projectRoot, directory ?? "src/locales");
  const mapped = isPathInside(source, configured, true)
    ? path.resolve(sourceBase, path.relative(source, configured))
    : configured;
  return {
    directory: mapped,
    compiled:
      path.resolve(sourceBase) !== path.resolve(source) &&
      isPathInside(sourceBase, mapped, true),
  };
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
    outDir: path.resolve(
      projectRoot,
      input.outDir ?? (mode === "development" ? ".vext/client" : "dist/client"),
    ),
  };
}
