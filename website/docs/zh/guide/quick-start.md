# 快速开始

:::tip 稳定版本
本站当前记录稳定发布的 `v2.0.0`。通用安装命令不固定精确版本；安装后可用 `npm ls vextjs` 查看实际版本，并按对应发布说明核对功能与升级变化。
:::

前置条件：Node.js `^20.19.0 || >=22.12.0`、npm，以及可写的项目目录。先用 `node --version` 和 `npm --version` 确认环境。下面的创建命令是不同选择，不要依次在同一目标目录执行。

## 方式一：使用脚手架（推荐）

VextJS 提供 `vext create` 命令创建可运行项目。默认模板会直接证明一套路由模型：`/` 通过 `res.render()` 渲染 React，`/api/hello` 返回 JSON，两者都调用生成的 example service；不需要页面运行时则选择 API-only。

```bash
# 创建 TypeScript 全栈项目（默认 Native Adapter）
npx vextjs create my-app
```

创建完成后，在生成目录启动：

正常创建会安装依赖；使用 `--skip-install` 或安装失败后，先在生成目录执行 `npm install`，再启动。

```bash
cd my-app
npm run dev
```

默认全栈模板访问 `http://localhost:3000` 查看服务端渲染starter，API路由位于 `/api/hello` 与 `/api/health`。API-only模板的入口是 `/` 和 `/health`，不会生成React页面。启用OpenAPI后访问 `/docs` 查看文档。

验收：全栈模板首页应显示starter，`GET /api/hello` 返回200与问候数据，`GET /api/health` 返回200且 `data.status` 为 `"ok"`；API-only按 `/`、`/health` 验证。实际端口以启动输出为准。

默认全栈项目完成开发验证后，先用 Ctrl+C 停止开发服务，再构建并启动生产服务，然后重复访问首页和两个 API：

```bash
npm run build
npm start
```

### 其他创建选项

以下是替代默认创建命令的选项。选择其中一种，在尚不存在的目标目录创建；API-only 使用 `my-api` 时，后续进入该目录。

```bash
# 创建并指定 Adapter
npx vextjs create my-app --adapter hono

# 创建 JavaScript 全栈项目
npx vextjs create my-app --js

# 创建 API-only 项目
npx vextjs create my-api --template api --frontend none

# 跳过 npm install
npx vextjs create my-app --skip-install
```

## 方式二：手动创建

以下提供完整的 TypeScript API-only 最小项目。需要React/SSR时优先使用上方全栈模板，或继续按[前端快速开始](/zh/frontend/getting-started)补齐依赖、页面、document、样式和渲染路由；仅创建空frontend目录不会产生可访问页面。

### 1. 初始化项目

```bash
mkdir my-app
cd my-app
npm init -y
npm install vextjs
npm install -D typescript@5 @types/node@20
```

### 2. 配置 `package.json`

将下面的ESM设置和scripts合入上一步生成的package.json，保留npm实际写入的dependencies、devDependencies及lockfile。示例省略依赖字段，不要求把已安装版本改成文档中的固定值。

```json
{
  "name": "my-app",
  "type": "module",
  "scripts": {
    "start": "vext start",
    "dev": "vext dev",
    "build": "vext build --typecheck"
  }
}
```

:::tip
VextJS 要求 `"type": "module"`，项目使用 ESM 模块格式。
:::

### 3. 创建目录结构

在编辑器中创建 `src/config`、`src/routes`；使用可选service时再创建 `src/services`。Bash可使用：

```bash
mkdir -p src/config src/routes src/services
```

PowerShell可使用 `New-Item -ItemType Directory -Force src/config,src/routes,src/services`。不需要为可选能力预建所有空目录。

新增 `tsconfig.json`，供独立类型检查与build的typecheck阶段使用：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", ".vext/types/**/*.d.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 4. 编写配置

```typescript
// src/config/default.ts
export default {
  port: 3000,
  host: "0.0.0.0",
  logger: {
    level: "info",
  },
  openapi: {
    enabled: true,
  },
  frontend: { enabled: false },
};
```

如需使用其他Adapter（如Hono），先安装对应包，再把adapter字段合并进上面的配置，保留需要的openapi等字段：

```bash
npm install hono
```

```typescript
// src/config/default.ts
import { honoAdapter } from "vextjs/adapters/hono";

export default {
  adapter: honoAdapter(),
  port: 3000,
};
```

### 5. 编写路由

```typescript
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  // GET /api/hello
  app.get(
    "/api/hello",
    {
      docs: { summary: "Hello API" },
    },
    async (_req, res) => {
      res.json({ message: "Hello VextJS!" });
    },
  );

  // GET /api/health
  app.get(
    "/api/health",
    {
      docs: { summary: "健康检查" },
    },
    async (_req, res) => {
      res.json({
        status: "ok",
        uptime: process.uptime(),
      });
    },
  );
});
```

### 6. 编写服务（可选）

```typescript
// src/services/example.ts
export default class ExampleService {
  async getGreeting(name: string) {
    return { message: `Hello, ${name}!` };
  }
}
```

在路由中使用服务：

```typescript
// src/routes/greet.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/:name",
    {
      validate: {
        param: { name: "string!" },
      },
      docs: { summary: "问候接口" },
    },
    async (req, res) => {
      const { name } = req.valid("param");
      const result = await app.services.example.getGreeting(name);
      res.json(result);
    },
  );
});
```

### 7. 启动

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm run build
npm start
```

dev是长运行命令，完成开发验证后先停止它，再运行build/start，避免端口冲突。本文TypeScript项目需先成功构建再生产启动；纯JavaScript API模板可能直接从源码start，且不生成build脚本，按该模板实际package脚本执行。

手动最小项目验证（Windows PowerShell可使用 `curl.exe`）：

```bash
curl -i http://127.0.0.1:3000/api/hello
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/greet/Alice
```

前两条应200，`data.message` 为 `"Hello VextJS!"`、`data.status` 为 `"ok"`。加入可选service和greet路由后第三条应200、`data.message` 为 `"Hello, Alice!"`；文件greet本身已贡献 `/greet` 前缀，不要在子路径重复写 `/greet`。生产start后再次执行相同请求，并验证 `/docs` 与 `/openapi.json` 可访问。

手动API-only项目没有 `/` 页面，访问根路径404属于当前路由定义的预期。SSR完整配置见[前端快速开始](/zh/frontend/getting-started)。

<a id="41-可选添加-srcconfigbootstrapts"></a>

## 可选：启动期配置

如果某些配置必须在启动期从远端读取，并且要在 `config` 冻结前参与合并，可以新增 `src/config/bootstrap.ts`：

```typescript
import { defineBootstrapConfig } from "vextjs";

export default defineBootstrapConfig({
  providers: [
    {
      name: "remote-config",
      async load({ configProfile, signal }) {
        const response = await fetch(
          `https://config.example.com/${configProfile}.json`,
          {
            signal,
          },
        );
        if (!response.ok)
          throw new Error(`Config request failed: ${response.status}`);
        return await response.json();
      },
    },
  ],
});
```

适合：数据库、Nacos 启动期配置、密钥 patch。

上面的地址是说明provider用法的占位地址，未准备真实服务时不要加入最小项目。普通本地配置不需要bootstrap provider。

不适合：APM / OpenTelemetry 这类需要更早执行的 `preload` 场景。

## 项目结构

下面是默认TypeScript全栈脚手架的结构；手动API-only示例只需要上方实际创建的配置、路由、可选服务和项目文件，不会生成这些React资产：

```
my-app/
├── public/
│   ├── favicon.svg           # 使用同一 V 几何的高对比 favicon 变体
│   └── vext-mark.svg         # AppShell 使用的透明 V 标记
├── src/
│   ├── config/
│   │   ├── default.ts        # 共享配置（port: 3000）
│   │   ├── development.ts    # 开发环境 profile
│   │   ├── production.ts     # 生产环境 profile
│   │   ├── local.ts          # 空本地覆盖；被 Git 忽略
│   │   └── bootstrap.ts      # 可跟踪的启动入口，默认 providers: []
│   ├── frontend/
│   │   ├── components/AppShell.tsx # 公共 React shell
│   │   ├── locales/en-US.ts  # starter 文案
│   │   ├── pages/            # React 页面、layout、document 和错误页
│   │   └── styles/index.css  # Vext launchpad 样式
│   ├── routes/index.ts       # URL handler 和服务端数据
│   ├── services/example.ts   # 服务层
│   └── types/
│       ├── generated/.gitkeep # TypeScript 项目的 typegen 输出根
│       ├── shared/greeting.d.ts # 服务与前端共享的数据类型
│       └── frontend/home.d.ts # 首页 props 类型
├── package.json
├── tsconfig.json
└── .gitignore
```

:::info 约定
各角色按自己的Loader与配置生效：routes/services/plugins有约定入口，middlewares按挂载名称加载，frontend/public需要启用前端流程；普通共享目录只经import使用。初始脚手架只创建已有starter内容的目录。项目根 `preload/` 仅作为带warning的兼容回退保留。完整边界见[项目结构](/zh/guide/project-structure)。路由文件名会映射为URL前缀：

| 文件路径                       | URL 前缀          |
| ------------------------------ | ----------------- |
| `src/routes/index.ts`          | `/`               |
| `src/routes/users.ts`          | `/users`          |
| `src/routes/admin/index.ts`    | `/admin`          |
| `src/routes/admin/settings.ts` | `/admin/settings` |

:::

脚手架会直接创建零副作用的 `src/config/local.ts` 与 `src/config/bootstrap.ts`。`local.ts` 初始为空 `VextConfigOverride`，并被 `.gitignore` 排除，因此 fresh clone 中没有它也不影响 build/start；`bootstrap.ts` 初始为 `providers: []`，正常跟踪，后续可在 CLI override 前注册启动期 provider。service 类型、运行时常量与公共函数的所有权规则见[项目结构](/zh/guide/project-structure)。

默认全栈模板会展示 SSR Vext runtime launchpad，并明确呈现「路由 → 服务 → SSR → 浏览器运行时」链路；顶部导航同时提供官方 Vext Guide 和生成项目的本地 API 文档 `/docs`，次要行动按钮打开 Vext Guide。模板默认启用 `openapi.enabled: true`，因此本地文档入口在开发与生产模式都可用。模板只包含真实 starter 源码：不会生成根目录 README 或占位 README 文件。TypeScript、JavaScript 的全栈与 API-only 模板所生成的用户源码均以英文为默认语言，显式 locale 资源是唯一语言内容例外。AppShell 使用透明的 `public/vext-mark.svg`，`public/favicon.svg` 是采用相同 V 几何的高对比 favicon 变体。只有在添加对应源码时，才创建可选约定目录。

## 访问 OpenAPI 文档

默认 `fullstack-react` 模板和本文手动示例已经启用 `openapi.enabled: true`。脚手架的 API-only 模板默认不启用 OpenAPI，需要时先把该配置加入 `src/config/default.ts`，再启动项目。启用后的默认入口为：

- **Vext Docs 文档**: `http://localhost:3000/docs`
- **OpenAPI JSON**: `http://localhost:3000/openapi.json`

## CLI 命令速览

| 命令                 | 说明                                |
| -------------------- | ----------------------------------- |
| `vext dev`           | 开发模式，文件监听 + 热重载         |
| `vext start`         | 生产模式启动                        |
| `vext build`         | 构建项目（TypeScript → JavaScript） |
| `vext create <name>` | 创建新项目                          |
| `vext stop`          | 停止 Cluster 进程                   |
| `vext reload`        | 滚动重启 Worker                     |
| `vext status`        | 查看 Cluster 运行状态               |

## 开发模式热重载

`vext dev` 提供三层热重载策略，自动选择最优方式：

| 层级                    | 触发条件                            | 行为               | 速度             |
| ----------------------- | ----------------------------------- | ------------------ | ---------------- |
| **Tier 1** — 路由热替换 | 可安全替换的路由变更                | 替换请求处理器     | 取决于编译与加载 |
| **Tier 2** — 局部重载   | 可处理的服务 / i18n变更             | 服务重载或字典切换 | 取决于依赖范围   |
| **Tier 3** — 冷重启     | 配置 / 插件等变更或无法安全局部更新 | 完整重启worker     | 取决于启动成本   |

具体分类与失败回退见[热重载](/zh/guide/hot-reload)，不能把层级名称当成固定耗时或任何变更都不中断的保证。

## 常见启动问题

| 症状                | 处理                                                  | 复验                                 |
| ------------------- | ----------------------------------------------------- | ------------------------------------ |
| 找不到vext或依赖    | 确认当前项目目录并执行npm install                     | 再运行npm run dev                    |
| Node版本不满足      | 使用满足上方engines的Node                             | node --version后重新安装/启动        |
| 端口占用            | 停止自己此前启动的服务或修改port                      | 按实际监听端口请求hello              |
| /greet/greet才命中  | 文件前缀和子路径重复                                  | 改为本文 `/:name` 后请求/greet/Alice |
| frontend缺产物/依赖 | 核对模板；API-only保持frontend关闭，SSR按前端指南补全 | 重新build并验证页面                  |
| start找不到产物     | TypeScript应用先完成build并保持相同profile/outDir     | 生产start后重复API验证               |

## 下一步

- 了解 [项目结构](/zh/guide/project-structure) 约定
- 配置 [前端指南](/zh/frontend/overview)
- 学习 [路由](/zh/guide/routing) 的三段式定义
- 探索 [中间件](/zh/guide/middleware) 和 [插件](/zh/guide/plugins)
- 查看 [配置](/zh/guide/configuration) 选项
