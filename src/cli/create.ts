import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

/**
 * vext create — 项目脚手架命令（Phase 4）
 *
 * 一条命令创建可运行的 vext 项目，开箱即用。
 *
 * 命令行参数：
 *   <project-name>       项目名称（必填）
 *   --js                 生成 JavaScript 项目（默认 TypeScript）
 *   --template <name>    项目模板（默认 fullstack-react，支持 api）
 *   --frontend <name>    前端集成（react|none，默认随 template）
 *   --skip-install       跳过 npm install
 *   --adapter <name>     指定默认 adapter（hono|fastify|express|koa|native，默认 native）
 *   --force              目标目录存在时强制覆盖（不询问）
 *   -h, --help           显示帮助信息
 *
 * 环境变量：
 *   VEXT_PACKAGE         覆盖生成的 vextjs 依赖（file: 路径、tarball、版本或 npm spec）
 *
 * 用法示例：
 *   vext create my-app                  创建 TypeScript 项目
 *   vext create my-app --js             创建 JavaScript 项目
 *   vext create my-app --adapter native 使用 native adapter
 *   vext create my-app --skip-install   跳过依赖安装
 *   vext create my-app --force          目录存在时强制覆盖
 *
 * @module cli/create
 * @see 09-cli.md §11（vext create 项目脚手架）
 * @see IMPLEMENTATION-PLAN.md 任务 4.2
 */

// ── 类型定义 ────────────────────────────────────────────────

interface CreateOptions {
  /** 项目名称（目录名） */
  name: string;

  /** 项目语言 */
  language: "ts" | "js";

  /** 项目模板 */
  template: "api" | "fullstack-react";

  /** 前端集成 */
  frontend: "react" | "none";

  /** 跳过 npm install */
  skipInstall: boolean;

  /** 默认 adapter */
  adapter: string;

  /** 强制覆盖已存在的目录 */
  force: boolean;
}

// ── 常量 ────────────────────────────────────────────────────

const VALID_ADAPTERS = ["hono", "fastify", "express", "koa", "native"];
const VALID_TEMPLATES = ["api", "fullstack-react"];
const VALID_FRONTENDS = ["react", "none"];

/**
 * adapter 对应的 peer dependency 映射
 *
 * 仅在用户选择非 native adapter 时，自动添加对应的框架依赖。
 * native adapter 无第三方依赖。
 */
const ADAPTER_DEPS: Record<string, Record<string, string>> = {
  hono: {
    hono: "^4.0.0",
    "@hono/node-server": "^1.14.1",
  },
  fastify: {
    fastify: "^5.0.0",
  },
  express: {
    express: "^5.0.0",
  },
  koa: {
    "@koa/router": "^15.6.0",
    koa: "^3.0.0",
  },
  native: {},
};

const ADAPTER_DEV_DEPS: Record<string, Record<string, string>> = {
  hono: {},
  fastify: {},
  express: {
    "@types/express": "^5.0.0",
  },
  koa: {
    "@types/koa": "^3.0.0",
  },
  native: {},
};

// ── 版本读取 ──────────────────────────────────────────────────

/**
 * Scaffold dependency versions derived from the framework package.json.
 *
 * Full-stack templates must pin react/react-dom to the exact versions that
 * vextjs itself depends on. Using a floating caret range (e.g. `^19.2.7`) can
 * resolve a newer patch at install time while vextjs still requires the older
 * exact version, which nests a second copy under `node_modules/vextjs` and
 * breaks candidate-artifact tree identity checks (and can cause dual-React
 * runtime issues for end users).
 */
interface ScaffoldPackageVersions {
  /** Dependency spec written for the `vextjs` package. */
  vextjs: string;
  /** Exact react version aligned with vextjs dependencies. */
  react: string;
  /** Exact react-dom version aligned with vextjs dependencies. */
  reactDom: string;
}

const FALLBACK_SCAFFOLD_VERSIONS: ScaffoldPackageVersions = {
  vextjs: "latest",
  react: "19.2.7",
  reactDom: "19.2.7",
};

/**
 * readScaffoldPackageVersions — resolve dependency specs for generated package.json
 *
 * - Default public installs: `vextjs: ^<framework-version>` from npm.
 * - Verification / monorepo installs: when `VEXT_PACKAGE` is set (file path,
 *   tarball, or any npm dependency spec), write that exact spec instead so
 *   create/install resolves the frozen candidate rather than the registry.
 * - Full-stack react/react-dom pins always match the framework's own deps.
 */
async function readScaffoldPackageVersions(): Promise<ScaffoldPackageVersions> {
  let frameworkVersion = FALLBACK_SCAFFOLD_VERSIONS.vextjs;
  let react = FALLBACK_SCAFFOLD_VERSIONS.react;
  let reactDom = FALLBACK_SCAFFOLD_VERSIONS.reactDom;

  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as {
      version?: string;
      dependencies?: Record<string, string>;
    };
    if (pkg.version) {
      frameworkVersion = `^${pkg.version}`;
    }
    if (pkg.dependencies?.react) {
      react = pkg.dependencies.react;
    }
    if (pkg.dependencies?.["react-dom"]) {
      reactDom = pkg.dependencies["react-dom"];
    }
  } catch {
    // package.json 读取失败时使用 FALLBACK_SCAFFOLD_VERSIONS
  }

  // VEXT_PACKAGE overrides the vextjs dependency for candidate/local installs.
  // Accept absolute/relative paths (normalized to file:) or any npm spec.
  const packageOverride = process.env.VEXT_PACKAGE?.trim();
  let vextjs = frameworkVersion;
  if (packageOverride) {
    if (
      packageOverride.startsWith("file:") ||
      packageOverride.startsWith("link:") ||
      packageOverride.startsWith("workspace:") ||
      packageOverride.startsWith("npm:") ||
      packageOverride.startsWith("git+") ||
      packageOverride.startsWith("http://") ||
      packageOverride.startsWith("https://") ||
      // bare version / tag / range
      /^[\^~>=<\d*]/.test(packageOverride) ||
      packageOverride === "latest" ||
      packageOverride === "next"
    ) {
      vextjs = packageOverride;
    } else {
      // Treat bare filesystem paths as file: dependencies.
      vextjs = `file:${path.resolve(packageOverride).replaceAll("\\", "/")}`;
    }
  }

  return { vextjs, react, reactDom };
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * createCommand — vext create CLI 命令入口
 *
 * 解析命令行参数，检测目标目录，生成项目文件。
 *
 * @param args 命令行参数（如 ['my-app', '--js']）
 */
export async function createCommand(args: string[] = []): Promise<void> {
  // ── 解析命令行参数 ────────────────────────────────────────
  const options = parseCreateArgs(args);

  if (!options) {
    // --help 已打印，或解析失败已输出错误
    return;
  }

  const targetDir = path.resolve(process.cwd(), options.name);

  // ── 检查目标目录 ──────────────────────────────────────────
  if (fs.existsSync(targetDir)) {
    const entries = fs.readdirSync(targetDir);
    if (entries.length > 0) {
      if (!options.force) {
        const confirmed = await confirmOverwrite(options.name);
        if (!confirmed) {
          console.log("\n  ❌ Operation cancelled.\n");
          return;
        }
      }
      // 清理已存在的目录内容
      console.log(`\n  🗑️  Cleaning existing directory "${options.name}"...`);
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  }

  // ── 生成项目 ──────────────────────────────────────────────
  console.log(
    `\n  🚀 Creating vext project "${options.name}"...\n` +
      `     Language: ${options.language === "ts" ? "TypeScript" : "JavaScript"}\n` +
      `     Adapter:  ${options.adapter}\n` +
      `     Template: ${options.template}\n`,
  );

  const packageVersions = await readScaffoldPackageVersions();
  await generateProject(targetDir, options, packageVersions);

  // ── npm install ───────────────────────────────────────────
  if (!options.skipInstall) {
    console.log("  📦 Installing dependencies...\n");
    try {
      execSync("npm install", {
        cwd: targetDir,
        stdio: "inherit",
      });
      console.log("");
    } catch {
      console.error(
        "\n  ❌ npm install failed. Project files were generated, but dependencies were not installed.\n\n" +
          `  Retry:\n\n    cd ${options.name}\n    npm install\n`,
      );
      process.exitCode = 1;
      return;
    }
  }

  // ── 成功提示 ──────────────────────────────────────────────
  printSuccess(options);
}

// ── 参数解析 ────────────────────────────────────────────────

/**
 * 解析 vext create 命令的参数
 *
 * @param args 命令行参数
 * @returns 解析后的选项，或 null（--help 或解析失败）
 */
function parseCreateArgs(args: string[]): CreateOptions | null {
  // 手动检查 --help（在 parseArgs 之前，避免缺少 positional 时报错）
  if (args.includes("--help") || args.includes("-h")) {
    printCreateHelp();
    return null;
  }

  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        js: { type: "boolean", default: false },
        template: { type: "string", default: "fullstack-react" },
        frontend: { type: "string" },
        "skip-install": { type: "boolean", default: false },
        adapter: { type: "string", default: "native" },
        force: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: true,
    });

    // ── 项目名称 ──────────────────────────────────────────
    const name = positionals[0];
    if (!name) {
      console.error(
        "\n  ❌ Project name is required.\n\n" +
          "  Usage: vext create <project-name> [options]\n\n" +
          "  Run 'vext create --help' for more information.\n",
      );
      process.exit(1);
      return null;
    }

    if (positionals.length > 1) {
      console.error(
        `\n  ❌ Unexpected positional arguments: ${positionals
          .slice(1)
          .map((value) => `"${value}"`)
          .join(", ")}\n\n` +
          "  Usage: vext create <project-name> [options]\n\n" +
          "  Only one project name is accepted.\n",
      );
      process.exit(1);
      return null;
    }

    // 验证项目名称（不允许路径分隔符和特殊字符）
    if (!/^[a-zA-Z0-9_][\w.-]*$/.test(name)) {
      console.error(
        `\n  ❌ Invalid project name: "${name}"\n\n` +
          "  Project name must start with a letter, digit, or underscore,\n" +
          "  and can only contain letters, digits, underscores, hyphens, and dots.\n",
      );
      process.exit(1);
      return null;
    }

    // ── adapter 验证 ──────────────────────────────────────
    const adapter = (values.adapter as string) ?? "hono";
    if (!VALID_ADAPTERS.includes(adapter)) {
      console.error(
        `\n  ❌ Invalid adapter: "${adapter}"\n\n` +
          `  Available adapters: ${VALID_ADAPTERS.join(", ")}\n`,
      );
      process.exit(1);
      return null;
    }

    // ── template 验证 ─────────────────────────────────────
    const template = (values.template as string) ?? "fullstack-react";
    if (!VALID_TEMPLATES.includes(template)) {
      console.error(
        `\n  ❌ Invalid template: "${template}"\n\n` +
          `  Available templates: ${VALID_TEMPLATES.join(", ")}\n`,
      );
      process.exit(1);
      return null;
    }
    const frontend =
      (values.frontend as string | undefined) ??
      (template === "api" ? "none" : "react");
    if (!VALID_FRONTENDS.includes(frontend)) {
      console.error(
        `\n  ❌ Invalid frontend: "${frontend}"\n\n` +
          `  Available frontends: ${VALID_FRONTENDS.join(", ")}\n`,
      );
      process.exit(1);
      return null;
    }
    if (template === "api" && frontend !== "none") {
      console.error("\n  ❌ --template api only supports --frontend none.\n");
      process.exit(1);
      return null;
    }
    if (template === "fullstack-react" && frontend !== "react") {
      console.error(
        "\n  ❌ --template fullstack-react requires --frontend react.\n",
      );
      process.exit(1);
      return null;
    }

    return {
      name,
      language: values.js ? "js" : "ts",
      template: template as "api" | "fullstack-react",
      frontend: frontend as "react" | "none",
      skipInstall: !!values["skip-install"],
      adapter,
      force: !!values.force,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n  ❌ ${message}\n`);
    console.error("  Run 'vext create --help' for usage information.\n");
    process.exit(1);
    return null;
  }
}

// ── 交互式确认 ──────────────────────────────────────────────

/**
 * 询问用户是否覆盖已存在的目录
 *
 * @param dirName 目录名
 * @returns 用户是否确认
 */
function confirmOverwrite(dirName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      `\n  ⚠️  Directory "${dirName}" already exists and is not empty.\n` +
        `     Do you want to overwrite it? (y/N) `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "y");
      },
    );
  });
}

// ── 项目生成 ────────────────────────────────────────────────

/**
 * 生成完整的项目文件
 *
 * @param targetDir 项目目标目录（绝对路径）
 * @param options   创建选项
 */
async function generateProject(
  targetDir: string,
  options: CreateOptions,
  packageVersions: ScaffoldPackageVersions,
): Promise<void> {
  // ── 1. 创建目录结构 ────────────────────────────────────
  const isTs = options.language === "ts";
  const isFullstack = options.template === "fullstack-react";
  const dirs = [
    "src/routes",
    "src/services",
    "src/middlewares",
    "src/plugins",
    "src/config",
    "src/locales",
    "preload",
  ];
  if (isFullstack) {
    dirs.push(
      "src/frontend/pages/error",
      "src/frontend/components",
      "src/frontend/styles",
      "src/frontend/assets",
      "src/frontend/locales",
      "public",
    );
  }

  if (isTs) {
    dirs.push("src/types/generated");
  }

  for (const dir of dirs) {
    fs.mkdirSync(path.join(targetDir, dir), { recursive: true });
  }

  // ── 2. 生成所有模板文件 ────────────────────────────────
  const templates = getTemplateFiles(options, packageVersions);

  for (const [filePath, content] of Object.entries(templates)) {
    const fullPath = path.join(targetDir, filePath);
    // 确保父目录存在
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  // ── 3. 写入占位 README 到空目录 ────────────────────────
  const emptyDirs = ["src/middlewares", "src/plugins"];
  for (const dir of emptyDirs) {
    const readmePath = path.join(targetDir, dir, `README.md`);
    const dirName = path.basename(dir);
    fs.writeFileSync(
      readmePath,
      `# ${dirName}\n\nPlace your custom ${dirName} here.\n\n` +
        `See the [vext documentation](https://github.com/vextjs/vext) for details.\n`,
      "utf-8",
    );
  }

  console.log(
    `  ✅ Project files generated (${Object.keys(templates).length + emptyDirs.length} files)\n`,
  );
}

// ── 模板文件 ────────────────────────────────────────────────

/**
 * 获取所有模板文件内容
 *
 * 返回 { 相对路径: 文件内容 } 的映射表。
 * 所有模板内容为内置字符串，零网络依赖。
 *
 * @param options 创建选项
 * @returns 模板文件映射
 */
function getTemplateFiles(
  options: CreateOptions,
  packageVersions: ScaffoldPackageVersions,
): Record<string, string> {
  const { name, language, adapter } = options;
  const ext = language === "ts" ? "ts" : "js";
  const isTs = language === "ts";
  const isFullstack = options.template === "fullstack-react";

  const files: Record<string, string> = {};

  // ── package.json ──────────────────────────────────────
  files["package.json"] = generatePackageJson(
    name,
    language,
    adapter,
    packageVersions,
    isFullstack,
  );

  // ── .gitignore ────────────────────────────────────────
  files[".gitignore"] = generateGitignore();

  // ── README.md ─────────────────────────────────────────
  files["README.md"] = generateReadme(name, adapter, ext, isTs, isFullstack);

  // ── tsconfig.json（TS 项目专用）────────────────────────
  if (isTs) {
    files["tsconfig.json"] = generateTsconfig(isFullstack);
  }

  // ── src/config/default ────────────────────────────────
  files[`src/config/default.${ext}`] = generateDefaultConfig(
    adapter,
    isTs,
    isFullstack,
  );

  // ── src/config/development ────────────────────────────
  files[`src/config/development.${ext}`] = generateDevelopmentConfig(isTs);

  // ── src/config/production ─────────────────────────────
  files[`src/config/production.${ext}`] = generateProductionConfig(isTs);

  // ── src/config/local.example ──────────────────────────
  files[`src/config/local.example.${ext}`] = generateLocalExampleConfig(isTs);

  // ── src/config/bootstrap.example ──────────────────────
  files[`src/config/bootstrap.example.${ext}`] =
    generateBootstrapExampleConfig(isTs);

  // ── src/routes/index ──────────────────────────────────
  files[`src/routes/index.${ext}`] = generateIndexRoute(isTs, isFullstack);

  // ── src/services/example ──────────────────────────────
  files[`src/services/example.${ext}`] = generateExampleService(isTs);

  // ── optional convention directories ───────────────────
  files["src/locales/README.md"] = generateLocalesReadme();
  files["preload/README.md"] = generatePreloadReadme();

  if (isTs) {
    files["src/types/generated/.gitkeep"] = "";
  }

  if (isFullstack) {
    const viewExt = isTs ? "tsx" : "jsx";
    const localeExt = isTs ? "ts" : "js";
    files[`src/frontend/pages/index.${viewExt}`] =
      generateFrontendHomePage(isTs);
    files[`src/frontend/pages/layout.${viewExt}`] =
      generateFrontendLayout(isTs);
    files[`src/frontend/pages/error/default.${viewExt}`] =
      generateFrontendErrorPage(isTs);
    files["src/frontend/pages/_document.html"] = generateFrontendDocument(name);
    files[`src/frontend/components/AppShell.${viewExt}`] =
      generateFrontendAppShell(isTs);
    files[`src/frontend/locales/en-US.${localeExt}`] = generateFrontendLocale();
    files["src/frontend/styles/index.css"] = generateFrontendStyles();
    files["public/favicon.svg"] = generateFaviconSvg();
  }

  return files;
}

// ── 模板生成函数 ────────────────────────────────────────────

function generatePackageJson(
  name: string,
  language: "ts" | "js",
  adapter: string,
  packageVersions: ScaffoldPackageVersions,
  isFullstack: boolean,
): string {
  const isTs = language === "ts";

  const deps: Record<string, string> = {
    vextjs: packageVersions.vextjs,
    ...ADAPTER_DEPS[adapter],
    // Pin exact versions to match vextjs runtime deps (no floating caret).
    ...(isFullstack
      ? { react: packageVersions.react, "react-dom": packageVersions.reactDom }
      : {}),
  };

  const devDeps: Record<string, string> = {
    ...(isTs ? { typescript: "^5.4.0" } : {}),
    ...(isFullstack && isTs
      ? { "@types/react": "^19.2.17", "@types/react-dom": "^19.2.3" }
      : {}),
    ...(isTs ? ADAPTER_DEV_DEPS[adapter] : {}),
  };

  // 按 key 排序
  const sortObj = (obj: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
    );

  const pkg: Record<string, unknown> = {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "vext dev",
      build: isTs || isFullstack ? "vext build" : undefined,
      start: "vext start",
    },
    dependencies: sortObj(deps),
  };

  // 清理 undefined scripts
  const scripts = pkg.scripts as Record<string, unknown>;
  for (const key of Object.keys(scripts)) {
    if (scripts[key] === undefined) {
      delete scripts[key];
    }
  }

  if (Object.keys(devDeps).length > 0) {
    pkg.devDependencies = sortObj(devDeps);
  }

  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function generateGitignore(): string {
  return `# dependencies
node_modules/

# build output
dist/
.vext/

# environment
.env
.env.local
.env.*.local

# local config (secrets)
src/config/local.ts
src/config/local.js

# editor
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# logs
*.log
logs/

# coverage
coverage/
`;
}

function generateReadme(
  name: string,
  adapter: string,
  ext: string,
  isTs: boolean,
  isFullstack: boolean,
): string {
  const optionalStructureLines = isTs
    ? `├── locales/         # Optional i18n language packs
└── types/generated/ # Generated TypeScript declarations`
    : `└── locales/         # Optional i18n language packs`;
  const frontendStructure = isFullstack
    ? `├── frontend/
│   ├── pages/       # React pages, layouts, document and error pages
│   ├── components/  # Shared React components
│   ├── styles/      # CSS and JSCSS-ready style entry
│   ├── assets/      # Bundled images, fonts and static imports
│   └── locales/     # Frontend page messages
`
    : "";
  const frontendUsage = isFullstack
    ? `
## Frontend Rendering

The default full-stack template renders React pages from Vext routes:

\`\`\`${ext}
app.get('/', {}, async (req, res) => {
  const greeting = await app.services.example.greeting('Vext')
  res.render('index', { greeting })
})
\`\`\`

- Page files live in \`src/frontend/pages/**\`.
- Shared components live in \`src/frontend/components/**\` and can be imported with \`@components/...\`.
- The HTML document is \`src/frontend/pages/_document.html\` and uses \`{vext.root}\`, \`{vext.data}\`, \`{vext.entry}\`, and \`{vext.styles}\`.
- Static files in \`public/\` are copied to the frontend output directory.
`
    : "";

  return `# ${name}

A [vext](https://github.com/vextjs/vext) project.

## Getting Started

\`\`\`bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm start
\`\`\`

## Project Structure

\`\`\`
src/
${frontendStructure}├── config/          # Configuration files and examples
├── routes/          # Route definitions
├── services/        # Business logic services
├── middlewares/     # Custom middlewares
├── plugins/         # Custom plugins
${optionalStructureLines}

preload/             # Optional process-level preload scripts
\`\`\`

## Configuration

- **Adapter**: \`${adapter}\`
- **Template**: \`${isFullstack ? "fullstack-react" : "api"}\`
- **Port**: \`3000\` (default)

Edit \`src/config/default.${ext}\` to customize shared configuration.
Copy \`src/config/local.example.${ext}\` to \`src/config/local.${ext}\` for local-only overrides.
Copy \`src/config/bootstrap.example.${ext}\` to \`src/config/bootstrap.${ext}\` when you need startup-time config providers.
${frontendUsage}

## Learn More

- [vext Documentation](https://github.com/vextjs/vext)
- [API Reference](https://github.com/vextjs/vext#api)
`;
}

function generateLocalExampleConfig(isTs: boolean): string {
  if (isTs) {
    return `import type { VextUserConfig } from 'vextjs'

// Copy this file to local.ts for machine-specific overrides.
// Do not commit local.ts; it may reference private infrastructure.
const config: Partial<VextUserConfig> = {
  logger: {
    level: 'debug',
    pretty: true,
  },
}

export default config
`;
  }

  return `/** @type {Partial<import('vextjs').VextUserConfig>} */
// Copy this file to local.js for machine-specific overrides.
// Do not commit local.js; it may reference private infrastructure.
const config = {
  logger: {
    level: 'debug',
    pretty: true,
  },
}

export default config
`;
}

function generateBootstrapExampleConfig(isTs: boolean): string {
  if (isTs) {
    return `import { defineBootstrapConfig } from 'vextjs'

// Copy this file to bootstrap.ts when startup-time config must be loaded
// before the final app config is validated and frozen.
export default defineBootstrapConfig({
  providers: [
    {
      name: 'example-provider',
      async load() {
        return null
      },
    },
  ],
})
`;
  }

  return `import { defineBootstrapConfig } from 'vextjs'

// Copy this file to bootstrap.js when startup-time config must be loaded
// before the final app config is validated and frozen.
export default defineBootstrapConfig({
  providers: [
    {
      name: 'example-provider',
      async load() {
        return null
      },
    },
  ],
})
`;
}

function generateLocalesReadme(): string {
  return `# locales

Place optional i18n language packs here, for example \`en-US.ts\` or \`zh-CN.ts\`.
vext loads this directory automatically when locale support is enabled.
`;
}

function generatePreloadReadme(): string {
  return `# preload

Place optional process-level preload scripts here.
Use this directory for OpenTelemetry, APM, polyfills, or startup bridges that must run before application code.
`;
}

function generateTsconfig(isFullstack: boolean): string {
  const config = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: isFullstack ? ["ES2022", "DOM", "DOM.Iterable"] : ["ES2022"],
      outDir: "./dist",
      rootDir: "./src",
      declaration: true,
      sourceMap: true,
      ...(isFullstack ? { jsx: "react-jsx" } : {}),
      ...(isFullstack
        ? {
            baseUrl: ".",
            paths: {
              "@frontend/*": [
                "src/frontend/*",
                "src/frontend/*.js",
                "src/frontend/*/index.js",
              ],
              "@pages/*": [
                "src/frontend/pages/*",
                "src/frontend/pages/*.js",
                "src/frontend/pages/*/index.js",
              ],
              "@components/*": [
                "src/frontend/components/*",
                "src/frontend/components/*.js",
                "src/frontend/components/*/index.js",
              ],
              "@styles/*": [
                "src/frontend/styles/*",
                "src/frontend/styles/*.js",
                "src/frontend/styles/*/index.js",
              ],
              "@assets/*": [
                "src/frontend/assets/*",
                "src/frontend/assets/*.js",
                "src/frontend/assets/*/index.js",
              ],
            },
          }
        : {}),
      strict: true,
      noUncheckedIndexedAccess: true,
      forceConsistentCasingInFileNames: true,
      esModuleInterop: true,
      isolatedModules: true,
      skipLibCheck: true,
      resolveJsonModule: true,
    },
    include: isFullstack
      ? ["src/**/*.ts", "src/**/*.tsx", "src/**/*.d.ts"]
      : ["src/**/*.ts", "src/**/*.d.ts"],
    exclude: ["node_modules", "dist"],
  };

  return `${JSON.stringify(config, null, 2)}\n`;
}

function generateDefaultConfig(
  adapter: string,
  isTs: boolean,
  isFullstack: boolean,
): string {
  const frontendBlock = isFullstack
    ? `  frontend: {
    enabled: true,
    framework: 'react',
    publicDir: 'public',
    publicPath: '/',
    i18n: {
      enabled: true,
      defaultLocale: 'en-US',
    },
    dev: {
      renderRefresh: 'prompt',
    },
  },
`
    : "";

  if (isTs) {
    return `import type { VextUserConfig } from 'vextjs'

const config: VextUserConfig = {
  port: 3000,
  adapter: '${adapter}',
${frontendBlock}
}

export default config
`;
  }

  return `/** @type {import('vextjs').VextUserConfig} */
const config = {
  port: 3000,
  adapter: '${adapter}',
${frontendBlock}
}

export default config
`;
}

function generateDevelopmentConfig(isTs: boolean): string {
  if (isTs) {
    return `import type { VextUserConfig } from 'vextjs'

const config: Partial<VextUserConfig> = {
  logger: {
    level: 'debug',
    pretty: true,
  },
}

export default config
`;
  }

  return `/** @type {Partial<import('vextjs').VextUserConfig>} */
const config = {
  logger: {
    level: 'debug',
    pretty: true,
  },
}

export default config
`;
}

function generateProductionConfig(isTs: boolean): string {
  if (isTs) {
    return `import type { VextUserConfig } from 'vextjs'

const config: Partial<VextUserConfig> = {
  port: 3001,
  logger: {
    level: 'info',
    pretty: false,
  },
}

export default config
`;
  }

  return `/** @type {Partial<import('vextjs').VextUserConfig>} */
const config = {
  port: 3001,
  logger: {
    level: 'info',
    pretty: false,
  },
}

export default config
`;
}

function generateIndexRoute(isTs: boolean, isFullstack: boolean): string {
  if (isFullstack) {
    if (isTs) {
      return `import { defineRoutes } from 'vextjs'

export default defineRoutes((app) => {
  app.get('/', {}, async (req, res) => {
    const greeting = await app.services.example.greeting('Vext')
    res.render(
      'index',
      {
        greeting,
        renderedAt: new Date().toISOString(),
      },
      {
        head: {
          title: 'Vext full-stack app',
          description: 'A React 19 page rendered by Vext routes and services.',
        },
        layoutData: {
          default: {
            section: 'Dashboard',
          },
        },
      },
    )
  })

  app.get('/api/hello', {}, async (req, res) => {
    const greeting = await app.services.example.greeting('Vext')
    res.json(greeting)
  })

  app.get('/api/health', {}, async (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() })
  })
})
`;
    }

    return `import { defineRoutes } from 'vextjs'

export default defineRoutes((app) => {
  app.get('/', {}, async (req, res) => {
    const greeting = await app.services.example.greeting('Vext')
    res.render(
      'index',
      {
        greeting,
        renderedAt: new Date().toISOString(),
      },
      {
        head: {
          title: 'Vext full-stack app',
          description: 'A React 19 page rendered by Vext routes and services.',
        },
        layoutData: {
          default: {
            section: 'Dashboard',
          },
        },
      },
    )
  })

  app.get('/api/hello', {}, async (req, res) => {
    const greeting = await app.services.example.greeting('Vext')
    res.json(greeting)
  })

  app.get('/api/health', {}, async (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() })
  })
})
`;
  }

  const helloPath = "/";
  const healthPath = isFullstack ? "/api/health" : "/health";
  if (isTs) {
    return `import { defineRoutes } from 'vextjs'

export default defineRoutes((app) => {
  app.get('${helloPath}', {}, async (req, res) => {
    const greeting = await app.services.example.greeting('Vext')
    res.json(greeting)
  })

  app.get('${healthPath}', {}, async (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() })
  })
})
`;
  }

  return `import { defineRoutes } from 'vextjs'

export default defineRoutes((app) => {
  app.get('${helloPath}', {}, async (req, res) => {
    const greeting = await app.services.example.greeting('Vext')
    res.json(greeting)
  })

  app.get('${healthPath}', {}, async (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() })
  })
})
`;
}

function generateExampleService(isTs: boolean): string {
  if (isTs) {
    return `import type { VextApp } from 'vextjs'

/**
 * ExampleService — 示例服务
 *
 * 演示 vext service 的基本用法。
 * 服务文件放在 src/services/ 目录下，
 * 框架会自动扫描并注入到 app.services 中。
 *
 * 文件名决定 service key：
 *   src/services/example.ts → app.services.example
 *   src/services/user.ts    → app.services.user
 */
export default class ExampleService {
  private app: VextApp

  constructor(app: VextApp) {
    this.app = app
  }

  /**
   * 生成问候消息
   */
  async greeting(name: string): Promise<{ message: string }> {
    this.app.logger.info('Generating greeting', { name })
    return { message: \`Hello, \${name}! Welcome to vext.\` }
  }
}
`;
  }

  return `/**
 * ExampleService — 示例服务
 *
 * 演示 vext service 的基本用法。
 * 服务文件放在 src/services/ 目录下，
 * 框架会自动扫描并注入到 app.services 中。
 *
 * 文件名决定 service key：
 *   src/services/example.js → app.services.example
 *   src/services/user.js    → app.services.user
 */
export default class ExampleService {
  constructor(app) {
    this.app = app
  }

  /**
   * 生成问候消息
   */
  async greeting(name) {
    this.app.logger.info('Generating greeting', { name })
    return { message: \`Hello, \${name}! Welcome to vext.\` }
  }
}
`;
}

function generateFrontendHomePage(isTs: boolean): string {
  if (isTs) {
    return `import { useVextI18n } from 'vextjs/frontend'

type HomeMessages = {
  home: {
    eyebrow: string
    title: string
    intro: string
  }
}

type HomePageProps = {
  greeting: {
    message: string
  }
  renderedAt: string
}

export default function HomePage({ greeting, renderedAt }: HomePageProps) {
  const i18n = useVextI18n<HomeMessages>()

  return (
    <main className="home">
      <p className="eyebrow">{i18n.home.eyebrow}</p>
      <h1>{i18n.home.title}</h1>
      <p className="lead">{i18n.home.intro}</p>
      <dl className="facts">
        <div>
          <dt>Service data</dt>
          <dd>{greeting.message}</dd>
        </div>
        <div>
          <dt>Rendered at</dt>
          <dd>{renderedAt}</dd>
        </div>
      </dl>
    </main>
  )
}
`;
  }

  return `import { useVextI18n } from 'vextjs/frontend'

export default function HomePage({ greeting, renderedAt }) {
  const i18n = useVextI18n()

  return (
    <main className="home">
      <p className="eyebrow">{i18n.home.eyebrow}</p>
      <h1>{i18n.home.title}</h1>
      <p className="lead">{i18n.home.intro}</p>
      <dl className="facts">
        <div>
          <dt>Service data</dt>
          <dd>{greeting.message}</dd>
        </div>
        <div>
          <dt>Rendered at</dt>
          <dd>{renderedAt}</dd>
        </div>
      </dl>
    </main>
  )
}
`;
}

function generateFrontendLayout(isTs: boolean): string {
  if (isTs) {
    return `import type { ReactNode } from 'react'
import { AppShell } from '@components/AppShell'

type LayoutProps = {
  children?: ReactNode
  data?: {
    section?: string
  }
}

export default function RootLayout({ children, data }: LayoutProps) {
  return <AppShell section={data?.section ?? 'Home'}>{children}</AppShell>
}
`;
  }

  return `import { AppShell } from '@components/AppShell'

export default function RootLayout({ children, data }) {
  return <AppShell section={data?.section ?? 'Home'}>{children}</AppShell>
}
`;
}

function generateFrontendAppShell(isTs: boolean): string {
  if (isTs) {
    return `import type { ReactNode } from 'react'

type AppShellProps = {
  children?: ReactNode
  section: string
}

export function AppShell({ children, section }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          vext
        </a>
        <nav aria-label="Primary">
          <a href="/">Home</a>
          <a href="/api/health">Health</a>
        </nav>
        <span className="section">{section}</span>
      </header>
      {children}
    </div>
  )
}
`;
  }

  return `export function AppShell({ children, section }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          vext
        </a>
        <nav aria-label="Primary">
          <a href="/">Home</a>
          <a href="/api/health">Health</a>
        </nav>
        <span className="section">{section}</span>
      </header>
      {children}
    </div>
  )
}
`;
}

function generateFrontendErrorPage(isTs: boolean): string {
  if (isTs) {
    return `type ErrorPageProps = {
  error?: {
    status?: number
    message?: string
    requestId?: string
  }
}

export default function DefaultErrorPage({ error }: ErrorPageProps) {
  const status = error?.status ?? 500
  return (
    <main className="error-page">
      <p className="eyebrow">Request failed</p>
      <h1>{status}</h1>
      <p>{error?.message ?? 'Something went wrong.'}</p>
      {error?.requestId ? <small>Request ID: {error.requestId}</small> : null}
    </main>
  )
}
`;
  }

  return `export default function DefaultErrorPage({ error }) {
  const status = error?.status ?? 500
  return (
    <main className="error-page">
      <p className="eyebrow">Request failed</p>
      <h1>{status}</h1>
      <p>{error?.message ?? 'Something went wrong.'}</p>
      {error?.requestId ? <small>Request ID: {error.requestId}</small> : null}
    </main>
  )
}
`;
}

function generateFrontendLocale(): string {
  return `export default {
  home: {
    eyebrow: 'Vext full-stack',
    title: 'Routes render React pages',
    intro:
      'Prepare data in a route or service, then render a React page with res.render().',
  },
}
`;
}

function generateFrontendStyles(): string {
  return `:root {
  color: #172026;
  background: #f7f9fb;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

.app-shell {
  min-height: 100vh;
}

.topbar {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 24px;
  border-bottom: 1px solid #d6dde5;
  background: #ffffff;
}

.brand {
  color: #172026;
  font-weight: 800;
  text-decoration: none;
}

.topbar nav {
  display: flex;
  gap: 14px;
}

.topbar nav a {
  color: #52606d;
  font-size: 14px;
  text-decoration: none;
}

.section {
  margin-left: auto;
  color: #6b7280;
  font-size: 13px;
}

.home,
.error-page {
  min-height: calc(100vh - 56px);
  display: grid;
  align-content: center;
  gap: 18px;
  padding: 48px clamp(20px, 6vw, 80px);
}

.home {
  max-width: 960px;
}

.eyebrow {
  margin: 0;
  color: #3b6ea8;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  max-width: 760px;
  font-size: 48px;
  line-height: 1.05;
}

p {
  margin: 0;
  color: #52606d;
}

.lead {
  max-width: 640px;
  font-size: 18px;
  line-height: 1.6;
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin: 16px 0 0;
}

.facts div {
  border: 1px solid #d6dde5;
  border-radius: 8px;
  background: #ffffff;
  padding: 18px;
}

dt {
  margin-bottom: 8px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

dd {
  margin: 0;
  color: #172026;
  font-weight: 600;
}

.error-page {
  max-width: 720px;
}

.error-page small {
  color: #6b7280;
}
`;
}

function generateFrontendDocument(name: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
    {vext.head}
    {vext.styles}
  </head>
  <body>
    {vext.root}
    {vext.data}
    {vext.entry}
  </body>
</html>
`;
}

function generateFaviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#172026"/>
  <path d="M18 18h28L34 46h-8l8-18H18z" fill="#6ee7b7"/>
</svg>
`;
}

// ── 帮助输出 ────────────────────────────────────────────────

function printCreateHelp(): void {
  console.log(`
  Usage: vext create <project-name> [options]

  Create a new vext project from template.

  Arguments:
    <project-name>        Name of the project (used as directory name)

  Options:
    --js                  Create a JavaScript project (default: TypeScript)
    --adapter <name>      Default adapter (hono|fastify|express|koa|native, default: native)
    --template <name>     Project template (fullstack-react|api, default: fullstack-react)
    --frontend <name>     Frontend integration (react|none, default: by template)
    --skip-install        Skip npm install after project creation
    --force               Overwrite existing directory without asking
    -h, --help            Show this help message

  Environment:
    VEXT_PACKAGE=<spec>   Override the generated vextjs dependency
                          (file path, tarball, version, or npm spec).
                          When unset, scaffolds use ^<framework-version>
                          from the public registry.

  Examples:
    $ vext create my-app
    $ vext create my-app --js
    $ vext create my-api --template api
    $ vext create my-app --adapter fastify
    $ vext create my-app --skip-install
    $ vext create my-app --adapter native --js --force
    $ VEXT_PACKAGE=file:../vext vext create my-app --skip-install
`);
}

function printSuccess(options: CreateOptions): void {
  const cdCmd = `cd ${options.name}`;
  const installCmd = options.skipInstall ? "npm install\n  " : "";
  const devCmd = "npm run dev";

  console.log(`
  ✅ Project "${options.name}" created successfully!

  Get started:

  ${cdCmd}
  ${installCmd}${devCmd}

  Available commands:
    npm run dev      Start development server (with hot reload)
    npm start        Start production server${options.language === "ts" || options.template === "fullstack-react" ? "\n    npm run build    Build for production" : ""}

  📖 Documentation: https://vextjs.github.io
`);
}
