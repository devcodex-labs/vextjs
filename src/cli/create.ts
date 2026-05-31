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
 *   --template <name>    项目模板（默认 'api'，当前仅支持 api）
 *   --skip-install       跳过 npm install
 *   --adapter <name>     指定默认 adapter（hono|fastify|express|koa|native，默认 native）
 *   --force              目标目录存在时强制覆盖（不询问）
 *   -h, --help           显示帮助信息
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
  template: "api";

  /** 跳过 npm install */
  skipInstall: boolean;

  /** 默认 adapter */
  adapter: string;

  /** 强制覆盖已存在的目录 */
  force: boolean;
}

// ── 常量 ────────────────────────────────────────────────────

const VALID_ADAPTERS = ["hono", "fastify", "express", "koa", "native"];
const VALID_TEMPLATES = ["api"];

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
    "@koa/router": "^13.1.1",
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
 * readVextVersion — 读取 vext 框架当前版本号
 *
 * 动态读取框架自身的 package.json，用于脚手架生成项目时写入正确的 vextjs 依赖范围。
 * 与 index.ts 的 printVersion() 使用相同的 createRequire 模式，保持实现一致。
 *
 * @returns `^X.Y.Z` 格式的版本范围字符串；读取失败时降级为 `"latest"`
 */
async function readVextVersion(): Promise<string> {
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version: string };
    return `^${pkg.version}`;
  } catch {
    // package.json 读取失败时降级为 latest，避免写入不存在的版本号
    return "latest";
  }
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

  const vextVersion = await readVextVersion();
  await generateProject(targetDir, options, vextVersion);

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
      console.warn(
        "\n  ⚠️  npm install failed. You can run it manually later.\n",
      );
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
        template: { type: "string", default: "api" },
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
    const template = (values.template as string) ?? "api";
    if (!VALID_TEMPLATES.includes(template)) {
      console.error(
        `\n  ❌ Invalid template: "${template}"\n\n` +
          `  Available templates: ${VALID_TEMPLATES.join(", ")}\n`,
      );
      process.exit(1);
      return null;
    }

    return {
      name,
      language: values.js ? "js" : "ts",
      template: template as "api",
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
  vextVersion: string,
): Promise<void> {

  // ── 1. 创建目录结构 ────────────────────────────────────
  const dirs = [
    "src/routes",
    "src/services",
    "src/middlewares",
    "src/plugins",
    "src/config",
  ];

  for (const dir of dirs) {
    fs.mkdirSync(path.join(targetDir, dir), { recursive: true });
  }

  // ── 2. 生成所有模板文件 ────────────────────────────────
  const templates = getTemplateFiles(options, vextVersion);

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
  vextVersion: string,
): Record<string, string> {
  const { name, language, adapter } = options;
  const ext = language === "ts" ? "ts" : "js";
  const isTs = language === "ts";

  const files: Record<string, string> = {};

  // ── package.json ──────────────────────────────────────
  files["package.json"] = generatePackageJson(
    name,
    language,
    adapter,
    vextVersion,
  );

  // ── .gitignore ────────────────────────────────────────
  files[".gitignore"] = generateGitignore();

  // ── README.md ─────────────────────────────────────────
  files["README.md"] = generateReadme(name, adapter);

  // ── tsconfig.json（TS 项目专用）────────────────────────
  if (isTs) {
    files["tsconfig.json"] = generateTsconfig();
  }

  // ── src/config/default ────────────────────────────────
  files[`src/config/default.${ext}`] = generateDefaultConfig(adapter, isTs);

  // ── src/config/development ────────────────────────────
  files[`src/config/development.${ext}`] = generateDevelopmentConfig(isTs);

  // ── src/config/production ─────────────────────────────
  files[`src/config/production.${ext}`] = generateProductionConfig(isTs);

  // ── src/routes/index ──────────────────────────────────
  files[`src/routes/index.${ext}`] = generateIndexRoute(isTs);

  // ── src/services/example ──────────────────────────────
  files[`src/services/example.${ext}`] = generateExampleService(isTs);

  return files;
}

// ── 模板生成函数 ────────────────────────────────────────────

function generatePackageJson(
  name: string,
  language: "ts" | "js",
  adapter: string,
  vextVersion: string,
): string {
  const isTs = language === "ts";

  const deps: Record<string, string> = {
    vextjs: vextVersion,
    ...ADAPTER_DEPS[adapter],
  };

  const devDeps: Record<string, string> = {
    ...(isTs ? { typescript: "^5.4.0" } : {}),
    ...ADAPTER_DEV_DEPS[adapter],
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
      build: isTs ? "vext build" : undefined,
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

function generateReadme(name: string, adapter: string): string {
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
├── config/          # Configuration files (default, development, production)
├── routes/          # Route definitions
├── services/        # Business logic services
├── middlewares/      # Custom middlewares
└── plugins/         # Custom plugins
\`\`\`

## Configuration

- **Adapter**: \`${adapter}\`
- **Port**: \`3000\` (default)

Edit \`src/config/default.ts\` to customize your configuration.

## Learn More

- [vext Documentation](https://github.com/vextjs/vext)
- [API Reference](https://github.com/vextjs/vext#api)
`;
}

function generateTsconfig(): string {
  const config = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      outDir: "./dist",
      rootDir: "./src",
      declaration: true,
      sourceMap: true,
      strict: true,
      noUncheckedIndexedAccess: true,
      forceConsistentCasingInFileNames: true,
      esModuleInterop: true,
      isolatedModules: true,
      skipLibCheck: true,
      resolveJsonModule: true,
    },
      include: ["src/**/*.ts", "src/**/*.d.ts"],
      exclude: ["node_modules", "dist"],
    };

  return `${JSON.stringify(config, null, 2)}\n`;
}

function generateDefaultConfig(adapter: string, isTs: boolean): string {
  if (isTs) {
    return `import type { VextUserConfig } from 'vextjs'

const config: VextUserConfig = {
  port: 3000,
  adapter: '${adapter}',
}

export default config
`;
  }

  return `/** @type {import('vextjs').VextUserConfig} */
const config = {
  port: 3000,
  adapter: '${adapter}',
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

function generateIndexRoute(isTs: boolean): string {
  if (isTs) {
    return `import { defineRoutes } from 'vextjs'

export default defineRoutes((app) => {
  app.get('/', {}, async (req, res) => {
    const greeting = await app.services.example.greeting('Vext')
    res.json(greeting)
  })

  app.get('/health', {}, async (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() })
  })
})
`;
  }

  return `import { defineRoutes } from 'vextjs'

export default defineRoutes((app) => {
  app.get('/', {}, async (req, res) => {
    const greeting = await app.services.example.greeting('Vext')
    res.json(greeting)
  })

  app.get('/health', {}, async (req, res) => {
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
    --template <name>     Project template (default: api)
    --skip-install        Skip npm install after project creation
    --force               Overwrite existing directory without asking
    -h, --help            Show this help message

  Examples:
    $ vext create my-app
    $ vext create my-app --js
    $ vext create my-app --adapter fastify
    $ vext create my-app --skip-install
    $ vext create my-app --adapter native --js --force
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
    npm start        Start production server${options.language === "ts" ? "\n    npm run build    Build for production" : ""}

  📖 Documentation: https://vextjs.github.io
`);
}
