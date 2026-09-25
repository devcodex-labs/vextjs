# 热重载

VextJS 内置热重载机制，通过 `vext dev` 命令启动开发模式。框架监听文件变更，按职责执行后端 soft reload、前端重建或应用 worker 冷重启。

先用下方示例验证保存后响应变化，再了解重载范围、状态保留和失败恢复。热重载用于开发反馈；生产进程更新见 [Cluster](/zh/guide/cluster)。

## 快速开始

### 1. 准备应用与路由

使用已有 TypeScript API 应用，或按 [CLI](/zh/guide/cli#从创建到生产启动) 创建项目并安装依赖。在项目根目录新增：

```typescript
// src/routes/reload-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", async (_req, res) => {
    res.json({ message: "v1", pid: process.pid });
  });
});
```

文件名自动提供 `/reload-demo` 前缀；定义中的 `"/"` 不要重复写前缀。`pid` 仅用于此开发示例观察进程变化。

### 2. 启动并取得基线

```bash
npx vextjs dev --port 3000 --verbose-lifecycle
```

在另一个终端请求：

```bash
curl -i http://127.0.0.1:3000/reload-demo
```

应得到 HTTP 200，JSON 的 `data.message` 为 `"v1"`。记下 `data.pid`。已有 `"dev": "vext dev"` script 时，也可执行 `npm run dev -- --port 3000 --verbose-lifecycle`。

### 3. 修改已有文件

把上面路由中的 `"v1"` 改为 `"v2"` 并保存。等待终端出现成功重载结果，再重复请求。应仍为 HTTP 200、`data.message` 变为 `"v2"`；正常 soft reload 下 PID 保持不变。

详细日志会显示变更文件及阶段耗时，例如：

```text
[hot-reload] [OK] 45ms [T1:code] #1
```

数值只是示意。日志 `T1:code` 表示本批修改已有后端文件；编辑器若以删除再新建方式保存，也可能被识别为结构变更。

### 4. 验证新增与冷重启

- 复制此示例为 `src/routes/reload-extra.ts`：新增后请求 `/reload-extra` 应成功，正常日志为 `T2:structural`；删除后该路径应回到 404。
- 在 `src/config/default.ts` 的现有配置对象中添加或修改 `logger: { level: "debug" }` 并保存：等待重新 ready，再请求 `/reload-demo`，业务结果仍为 v2，但 PID 应改变。保留其他配置项。
- 如未看到预期响应，先检查终端是否报错或正在恢复，不要只凭“检测到文件变化”判断完成。

验证结束后用 Ctrl+C 停止开发服务。键盘 `h`、`r` 等交互需要前台终端支持；后台管道中不应依赖这些按键。

### 日志与前端更新

默认模式简洁输出地址、启动耗时与重载结果；`--verbose-lifecycle` 或 `--startup-profile` 才显示详细启动 Banner，前者还会输出变更列表和重载阶段耗时。

启用前端后，页面、组件和静态资源有独立的 client rebuild 路径，开发输出默认为 `.vext/client/`。React Fast Refresh、CSS 更新和后端重载后的浏览器刷新分别受前端开发配置控制，见 [Fast Refresh](/zh/frontend/fast-refresh) 与[渲染刷新](/zh/frontend/render-refresh)。后端请求验证成功不等于浏览器状态一定保留。

## 三层重载策略

先按文件职责分类为 cold、soft、client 或 ignore；**soft 内部再按修改类型选择 T1/T2**。服务或 Model 文件同样可能走 T1，新增路由同样可能走 T2。

### Tier 1 — 修改已有后端文件

适用于 soft 类文件的 `modify` 事件，例如 routes、services、middlewares、models 和 locales 中支持的源码/资源。

```text
编译变更文件
  → 计算模块与反向依赖的缓存失效范围
  → 更新相关语言包、中间件定义、受影响的 Service/Model
  → 创建新 adapter 并重新装配路由
  → 替换 HTTP handler 引用
```

最终替换的是请求入口，不是只更换某一个路由对象。原有 server socket 继续监听，新请求读取新 handler；已经进入旧 handler 的请求仍执行旧闭包，但它访问的 Service 等共享状态可能已经变化，不能承诺所有进行中请求完全不受影响。

耗时取决于依赖范围和重新装配工作。编译少量文件也可能引发广泛依赖失效；达到级联阈值时会升级为冷重启。

### Tier 2 — 新增、删除或全量重载

soft 文件出现 `add` / `delete`，或按 `h` 请求全量源码重载时，先重新扫描编译入口并重建，再执行与 T1 相同的运行态更新流程。

| 示例                            | 预期路径                       |
| ------------------------------- | ------------------------------ |
| 修改已有 `src/services/user.ts` | T1                             |
| 新增 `src/routes/orders.ts`     | T2                             |
| 删除 `src/services/unused.ts`   | T2，并移除已加载的对应服务引用 |
| 修改 `src/config/default.ts`    | cold，不进入 T1/T2             |

文件重命名通常表现为删除和新增。编辑器保存方式和同批其他文件变化也会影响最终事件类别。

### Tier 3 — 冷重启

配置、插件、preload、根目录 package.json/lockfile/tsconfig.json 和 `.env*` 等变化需要重新初始化 worker。开发父进程等待旧 worker 退出，再等待新 worker ready，期间服务可能不可用，请求也可能中断。

```text
变更检测与 preflight
  → 停止旧 worker
  → 刷新 preload 并启动新 worker
  → bootstrap 与监听完成
  → ready 后再次验证请求
```

修改中间件定义通常走 soft；修改配置中的中间件装配列表则因配置变化走 cold。依赖文件变化触发重启**不会自动执行 npm install**，应先安装实际需要的依赖。

### Service、Model 与共享状态

受影响 Service 会重新实例化，未失效实例通常保留。框架会尝试调用旧实例的可选 `dispose()`；dispose 失败记录警告，业务负责资源清理。进程内计数、定时器、长期缓存等不应假定能跨重载保存。

```typescript
// src/services/user.ts（独立示例；修改已有文件通常为 T1）
import type { VextApp } from "vextjs";

export default class UserService {
  constructor(private app: VextApp) {}

  async findAll() {
    this.app.logger.debug("UserService.findAll");
    return { items: [], total: 0 };
  }
}
```

按需从 `app.services` 读取当前实例；其他对象在构造时缓存的旧服务引用不会因属性替换自动更新。源码 import 依赖与运行时动态持有的对象引用也不能视为同一张依赖图。

启用数据库和 Model 加载后，受影响 Model 会尝试替换注册定义；这不等于执行数据库迁移或改写已有记录。下面仅演示定义文件，完整数据库前置配置与验证见[数据库](/zh/guide/database)：

```typescript
// src/models/item.ts
import type { VextModelDefinition } from "vextjs";

export default {
  collection: "items",
  schema: {
    title: "string!",
    price: "number",
  },
} satisfies VextModelDefinition;
```

Service/Model 局部恢复旧引用或定义不能撤销已发生的外部副作用。运行态更新失败时，整体流程会冷重启恢复一致状态。

## 重载策略决策表

以下以默认布局为例，实际还受已解析目录、变更事件与失败恢复影响：

| 变更文件                                                         | 常规动作               | 说明                             |
| ---------------------------------------------------------------- | ---------------------- | -------------------------------- |
| `src/routes/**`、`src/services/**`                               | soft：修改 T1，增删 T2 | 路由重新装配、受影响服务更新     |
| `src/middlewares/**`                                             | soft：修改 T1，增删 T2 | 中间件定义重新加载               |
| `src/models/**`                                                  | soft：修改 T1，增删 T2 | 数据库启用时替换受影响定义       |
| `src/locales/**` 的 JSON/源码                                    | soft：修改 T1，增删 T2 | 字典重新加载                     |
| 已启用前端的角色目录、public 资源                                | client rebuild         | React/CSS/页面更新取决于前端配置 |
| `src/config/**`、`src/plugins/**`                                | cold                   | 重新初始化应用                   |
| `src/preload/**`、兼容根目录 `preload/`                          | cold                   | 重新解析并执行 preload           |
| 根目录 `package.json`、支持的 lockfile、`tsconfig.json`、`.env*` | cold                   | 依赖和启动环境变化               |
| `src/types/generated/**`、生成产物目录                           | ignore                 | 避免生成工具触发循环             |

源码目录外显式配置的语言包/Model 读取目录由布局单独登记，其变更走 cold；不要把它们概括为只能监听 src。

## 与 `vext build` 的关系

`vext dev` 将后端源码编译到 `.vext/dev/`，再由 worker 加载这些开发产物，不需要预先执行 `vext build`。

| 命令         | 源码目录                                 | 编译方式                          | 热重载        |
| ------------ | ---------------------------------------- | --------------------------------- | ------------- |
| `vext dev`   | `src/`                                   | esbuild 即时编译                  | ✅ 三层热重载 |
| `vext start` | 所选构建目录，或 JS source 模式的 `src/` | TS 需先 build；纯 JS 后端无需编译 | ❌ 无         |
| `vext build` | `src/` → `dist/`                         | esbuild 生产编译                  | —             |

以下是具有对应 scripts 的 TypeScript 项目流程；纯 JavaScript 和自定义输出边界见[构建](/zh/guide/build)：

```bash
# 开发时
npm run dev          # vext dev，直接从 src/ 热重载

# 部署时
npm run build        # vext build，编译到 dist/
npm start            # vext start，从 dist/ 启动
```

## CLI 选项

```bash
vext dev [options]

Options:
  --port <port>        指定监听端口（覆盖配置文件）
  --host <host>        指定监听地址
  --config <name>      选择配置 profile（默认 development）
  --debounce <ms>      防抖间隔（毫秒，默认 0 不开启）
  --poll               强制轮询模式（Docker / NFS 环境）
  --poll-interval <ms> 轮询间隔（毫秒，默认 1000）
  --no-hot             后端文件变更使用 Cold Restart；纯前端变更仍可独立重建
  --strict-preflight   让 TypeScript 语义诊断重新阻塞启动 / 重载
  --port-conflict <strategy>
                       端口冲突策略：error / prompt / kill / next
  --verbose-lifecycle  输出详细生命周期日志与完整 watcher 变更列表
  --startup-profile    输出启动阶段摘要与详细耗时
  --startup-profile-json <path>
                       将启动阶段耗时写入 JSON 文件
  --clear              处理文件变更时清空控制台
  -h, --help           显示帮助信息
```

`--host ::` 会监听 IPv6 all interfaces；ready 日志会输出 `http://[::1]:PORT` 与 bracketed IPv6 Network URL。具体 IPv6 host 也会按 `http://[IPv6]:PORT` 展示。

```bash
# 使用自定义端口
vext dev --port 8080

# 指定监听地址
vext dev --host 127.0.0.1

# 开启 50ms 防抖（快速连续保存时合并为一次重载）
vext dev --debounce 50

# Docker / NFS 环境使用轮询模式
vext dev --poll --poll-interval 2000

# 端口冲突时自动使用下一个可用端口
vext dev --port-conflict next

# 排查 loader / hot reload 细节
vext dev --verbose-lifecycle

# 输出启动摘要与详细耗时，并写入 JSON
vext dev --startup-profile --startup-profile-json .vext/inspect/startup-profile.json
```

默认 `vext dev` 只打印监听地址与总启动耗时；`--startup-profile-json <path>` 只写 JSON，不会自动打印 summary/details。需要在终端看到每个阶段耗时时，显式使用 `--startup-profile`。

## 文件监听规则

### 监听范围

默认覆盖 src 中支持的源码/资源、public 静态资源、项目 preload，以及根目录指定的配置和依赖文件。启用前端后，还覆盖配置解析得到的页面、组件和 publicDir 等角色目录，包括 src 之外的项目内目录。

原生 fs.watch 与 polling 均使用快照发现增删；静态资源不局限于 JavaScript/CSS，例如 robots.txt 和 PDF 也可触发 client rebuild。语言包和 Model 自定义读取目录由后端布局单独登记。

### 忽略规则

一般生成区和依赖区（`node_modules/`、`dist/`、`build/`、`.vext/`、`.git/`）、`src/types/generated/`、框架临时模块及未识别的文件类型不会进入正常重载流程。根目录 `.env*` 有明确 cold 规则，不能笼统说所有点开头文件均忽略；前端静态目录也会覆盖普通文本资源。

**监听分类与编译排除是两层规则。** 当前普通 `src/**/*.test.ts`、`src/**/*.d.ts` 等可能被监听器分类为 soft，但编译器排除这些输入；修改它们可能得到跳过/编译诊断，不能承诺触发有效的业务替换。测试宜放在项目 `test/` 或 `tests/`，类型是否正确仍由 TypeScript 检查。

`coldPatterns` / `ignorePatterns` 是内部分类器扩展点，当前不能当作公开 `config.dev` 配置项使用。

### 防抖处理

默认 `debounce: 0`，不额外等待防抖窗口；操作仍需经过扫描、preflight 和串行队列。如需在快速连续保存时合并多次变更为一次重载，可通过 `--debounce <ms>` 开启防抖窗口。

例如：同时修改了 `routes/users.ts`（soft）和 `config/default.ts`（Tier 3），框架会执行一次 Tier 3 冷重启（包含所有变更）。

## 重载协调与失败恢复

前端监视目标来自本次已解析配置，支持自定义 `frontend.root`、页面/组件目录和 `publicDir`，包括 `src/` 之外的项目内目录。原生监视和 polling 都覆盖静态资源的任意文件扩展名（如 `robots.txt`、PDF），以及后端 `.mts/.cts` 文件的增删事件。配置重启后会更新监视目标；前后端文件在同一批变化时分别触发对应构建流程。开发父进程只接收目录信息，不为监视再次执行配置 provider。

首次检查和启动前会建立监听基线，启动期间保存的变更会继续处理。文件保存、手动重启和故障恢复按顺序执行；连续保存按路径合并并保留最终的增删状态。读取目录失败时保留上次完整快照并诊断重试，原生监听降级为 polling 时保留积压变更。

重载完成以实际 worker 处理结果为准。编译失败时保留上次合法后端产物；运行态已修改后失败或无法确认 worker 结果时，需要冷重启恢复。终端 `h` 触发后端源码全量重载，`r` 触发冷重启，`?` 显示帮助；冷重启会等待旧 worker 退出和新 worker 完成初始化。退出后不再启动排队任务。

多个独立项目可以同时运行；同一真实项目根的 `dev`、`build` 和写入型 `typegen` 共享写入所有权，竞争命令会报告冲突。`typegen --check` 保持只读。每个服务仍需使用各自可用的端口；不要把一个服务的目录配置成另一个服务的输出目录。

`vext dev` 在启动和处理重载/重启前执行 **dev preflight**：

- 自动运行基础 `typegen`，同步 `.vext/types/*.generated.d.ts`；TypeScript 项目还同步 `src/types/generated/index.d.ts`
- TypeScript 诊断默认异步运行，不等待它完成就继续启动或重载
- 如果基础 typegen 发现 blocking issue，则跳过本轮 reload / restart；如需让 TypeScript 语义诊断也阻塞，可使用 `--strict-preflight`

路由重载使用编译器的真实项目根、源码目录和输出目录；自定义更深的输出目录不会改变源码映射或清单位置。新处理器构建和缓存清理成功后才提交 `.vext/manifest/routes.json`，提交冲突会阻止替换并进入冷重启恢复。首次启动时，该清单先作为前端构建输入生成，因此判断服务就绪应使用启动完成回执，判断重载生效应使用实际重载结果。

soft reload 在编译与缓存失效前失败时，保留旧 handler 继续服务；缓存失效后，语言包、中间件、Service、Model 或路由装配失败，可能已经改变共享运行态，此时请求冷重启。恢复流程先停止可能混合运行态的 worker；若严格 preflight 阻止启动，服务会保持停止，修复后保存才重新启动。

前端构建失败会保留上一代有效产物；前后端混合变更只完成一部分时，后续恢复也可能升级为完整启动。终端发送成功不代表 worker 已完成；应等结果并检查实际请求。

## TypeScript 支持

开发后端由 esbuild 转译，TypeScript 类型诊断使用项目本地编译器的 `tsc --noEmit`。默认先刷新基础 typegen，类型诊断异步运行；这意味着服务 ready 时，类型检查可能仍未结束或已经报告错误。

- 基础 typegen 有阻断项：本轮启动/重载停止。
- 普通类型错误：默认输出诊断，但不阻塞 ready 或 reload。
- `--strict-preflight`：等待类型诊断，通过后才进入启动/重载。
- 缺少 tsconfig 的项目会跳过该 TypeScript 检查；项目有配置时应安装可解析的本地 TypeScript。

```bash
npx vextjs dev --strict-preflight
```

也可设置 `VEXT_DEV_STRICT_PREFLIGHT=1`，具体 shell 写法见[CLI](/zh/guide/cli)。类型检查不替代测试、Lint 和生产构建验证；有 typecheck script 时，在提交或 CI 中显式运行 `npm run typecheck`。

esbuild 使用受支持的 tsconfig 编译选项，不能把它等同于实现所有 tsc 发射选项。开发/生产 Source Map 形态也不同，见[构建的 Source Map 说明](/zh/guide/build#source-map)。

## 常见问题

### 修改后没有触发重载？

1. **检查实际监听角色与项目根** — 后端 src、已配置的前端/资源目录和指定根文件各有规则，任意根外文件不会自动监听
2. **区分监听与编译排除** — generated、测试和声明文件的边界见上文；Docker/NFS 可尝试 `--poll`
3. **检查终端输出** — 是否有错误信息（如语法错误导致编译失败）

### 热重载后行为不符合预期？

1. **尝试手动重启** — 按 `Ctrl+C` 停止后重新运行 `vext dev`
2. **检查是否完成替换或进入恢复** — 不要手动删除运行中的 `.vext/` 或修改已登记产物；需要干净进程时用 `r` 或重新启动命令
3. **检查对象引用与副作用** — 受影响服务按模块失效范围更新，动态缓存的旧引用和外部副作用不自动回滚；必要时冷重启

### 冷重启太慢？

1. **先定位启动阶段** — 用 `--startup-profile` 查明耗时。将工作移到 `onReady()` 不会自动消除 ready 前的等待；必需依赖仍应在接收请求前完成
2. **减少非必要初始化** — 在开发配置中关闭可选功能；插件是否支持禁用取决于自己的实现
3. **使用 `local.ts` 简化配置** — 本地开发时关闭不需要的功能（如限流、访问日志等）

### 端口占用怎么办？

冷重启时如果端口仍被占用，VextJS 不再承诺“内部自动重试直到恢复”。当前行为是按 `--port-conflict` / `VEXT_PORT_CONFLICT` 执行显式策略：

- `error`（默认）：直接失败
- `prompt`：交互式询问 `retry / kill / next / abort`
- `kill`：尝试终止占用进程
- `next`：自动切换到下一个可用端口

如果接受改用其他端口，可显式选择：

```bash
vext dev --port-conflict next
```

如果需要手动排查占用进程：

```bash
# 查看占用端口的进程
# macOS/Linux
lsof -i :3000

# Windows
netstat -ano | findstr :3000
```

## 与 Cluster 模式的关系

`vext dev` 使用一个开发父进程管理一个应用 worker，不启动生产 Cluster 的多个请求 worker。不能把“单个应用 worker”理解为系统中只有一个 Node 进程。

生产环境如需多进程，使用 `vext start` 配合 Cluster 配置：

```bash
# 开发 — 一个应用 worker + 热重载
vext dev

# 生产 — 按配置启用多 worker
vext start   # 配合 cluster.enabled: true
vext reload  # 支持的平台上发送滚动重启信号
```

Windows 上 `vext reload` 不支持该信号操作；发送成功也不等于滚动替换已完成。详见 [CLI reload](/zh/guide/cli)。

## 最佳实践

### 1. 充分利用 Tier 1/2

将大部分应用逻辑放在路由和服务层，可以让 Vext 更常使用定向重载路径。配置和插件变化较少时，再使用更稳妥的冷重启路径。

### 2. 配合 IDE 实时类型检查

虽然 `vext dev` 会输出 TypeScript 语义诊断，但 IDE 的实时类型检查仍然是最快的反馈来源。推荐同时开启 IDE 提示和 `npm run typecheck`；需要阻塞式 preflight 时再开启 strict 模式。

### 3. 开发环境简化配置

通过 `development.ts` 关闭生产环境才需要的功能，加速冷重启：

```typescript
// src/config/development.ts
export default {
  rateLimit: { enabled: false }, // 开发时关闭限流
  accessLog: { enabled: false }, // 减少日志噪音
  logger: { level: "debug" }, // 开发时使用 debug 级别
};
```

### 4. 使用 `_` 前缀共享代码

路由和服务目录中以 `_` 开头的文件不会被自动加载为路由/服务。修改这些工具文件时：

- 修改已有源码通常进入 T1；新增/删除通常进入 T2。
- 使用它的模块可沿反向依赖图进入失效集合；是否重建某个 Service 取决于该集合，不能仅凭工具文件位于 routes 或 services 判断。
- `_` 前缀是加载器命名约定，不表示编译器或监听器忽略该模块。

```
src/routes/
├── _utils.ts          # 修改时触发使用它的路由文件重载
├── users.ts           # import { helper } from './_utils.js'
└── orders.ts
```

## 下一步

- 了解 [CLI 命令](/zh/guide/cli) 的完整用法
- 学习 [Cluster 多进程](/zh/guide/cluster) 的生产环境部署
- 查看 [配置](/zh/guide/configuration) 的环境覆盖机制
- 探索 [测试](/zh/guide/testing) 确保热重载后的代码正确性
