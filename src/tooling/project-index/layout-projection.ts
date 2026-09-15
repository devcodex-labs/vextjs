import path from "node:path";
import {
  resolveFrontendLayout,
  resolveModelsDirectory,
  resolveLocaleDirectory,
  type FrontendLayoutInput,
} from "../../lib/project/layout.js";
import { resolveJobsDirectory } from "../../lib/jobs/job-loader.js";
import type { StaticConfigProjection } from "./config-projection.js";

export interface ConfiguredSourceLayout {
  directories: Record<
    string,
    { absolutePath: string; sourceRefs: string[]; explicit: boolean }
  >;
  files: Record<string, { absolutePath: string; sourceRefs: string[] }>;
  unknown: Record<string, string>;
}

/** 只消费逐字段配置事实，路径含义复用运行时解析器；动态无关字段不会抹去已知目录。 */
export function projectConfiguredSourceLayout(
  rootDir: string,
  config: StaticConfigProjection,
): ConfiguredSourceLayout {
  const result: ConfiguredSourceLayout = {
    directories: {},
    files: {},
    unknown: {},
  };
  const explicit = new Set<string>();
  const select = (field: string, roles: string[]): string | undefined => {
    const fact = config.field(field);
    if (
      fact.state === "absent" ||
      (fact.state === "known" && fact.value === undefined)
    )
      return undefined;
    if (
      fact.state !== "known" ||
      typeof fact.value !== "string" ||
      !fact.value.trim() ||
      fact.value.includes("\0")
    ) {
      for (const role of roles)
        result.unknown[role] =
          `${field}: ${fact.reason ?? "Expected a statically known non-empty directory string."}`;
      return undefined;
    }
    for (const role of roles) explicit.add(role);
    return fact.value;
  };
  const add = (role: string, absolutePath: string) => {
    if (!result.unknown[role])
      result.directories[role] = {
        absolutePath,
        sourceRefs: config.sourceFiles,
        explicit: explicit.has(role),
      };
  };
  const src = path.join(rootDir, "src");
  add(
    "models",
    resolveModelsDirectory(
      src,
      select("database.models.dir", ["models"]),
      rootDir,
    ),
  );
  add(
    "locales",
    resolveLocaleDirectory(
      rootDir,
      src,
      select("locale.directory", ["locales"]),
    ).directory,
  );
  try {
    add(
      "jobs",
      resolveJobsDirectory(src, select("jobs.dir", ["jobs"]), rootDir),
    );
  } catch (error) {
    result.unknown.jobs = String(error);
  }
  const frontendRoles = [
    "frontend",
    "frontend-pages",
    "frontend-components",
    "frontend-styles",
    "frontend-assets",
    "frontend-hooks",
    "frontend-lib",
    "frontend-locales",
  ];
  const input: FrontendLayoutInput = {
    root: select("frontend.root", frontendRoles),
    pages: {
      dir: select("frontend.pages.dir", ["frontend-pages"]),
      document: select("frontend.pages.document", ["frontend-pages"]),
      errorDir: select("frontend.pages.errorDir", ["frontend-pages"]),
    },
    componentsDir: select("frontend.componentsDir", ["frontend-components"]),
    styles: { entry: select("frontend.styles.entry", ["frontend-styles"]) },
    assetsDir: select("frontend.assetsDir", ["frontend-assets"]),
    publicDir: select("frontend.publicDir", ["public"]),
    entry: select("frontend.entry", ["frontend"]),
    indexHtml: select("frontend.indexHtml", ["frontend"]),
  };
  try {
    const layout = resolveFrontendLayout(rootDir, input, "development");
    for (const [role, directory] of Object.entries({
      frontend: layout.root,
      "frontend-pages": layout.pagesDir,
      "frontend-components": layout.componentsDir,
      "frontend-styles": path.dirname(layout.stylesEntry),
      "frontend-assets": layout.assetsDir,
      "frontend-hooks": path.join(layout.root, "hooks"),
      "frontend-lib": path.join(layout.root, "lib"),
      "frontend-locales": path.join(layout.root, "locales"),
      public: layout.publicDir,
    }))
      add(role, directory);
    if (!result.unknown["frontend-pages"])
      result.directories["frontend-errors"] = {
        absolutePath: layout.errorDir,
        sourceRefs: config.sourceFiles,
        explicit: true,
      };
    for (const [role, file] of Object.entries({
      "frontend-entry": layout.entry,
      "frontend-document": layout.document,
      "frontend-index": layout.indexHtml,
      "frontend-style-entry": layout.stylesEntry,
    })) {
      if (result.unknown.frontend || result.unknown["frontend-pages"]) continue;
      const relative = path.relative(rootDir, file).split(path.sep).join("/");
      if (relative.startsWith(".vext/") || relative.startsWith("dist/"))
        continue;
      result.files[role] = {
        absolutePath: file,
        sourceRefs: config.sourceFiles,
      };
    }
  } catch (error) {
    for (const role of [...frontendRoles, "public"])
      result.unknown[role] = String(error);
  }
  return result;
}
