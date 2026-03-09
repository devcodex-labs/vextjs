# 热重载

VextJS 内置智能热重载机制，通过 `vext dev` 命令启动开发模式。框架会监听文件变更，根据变更类型自动选择最优的重载策略，从毫秒级的热替换到完整的进程重启，覆盖所有开发场景。

## 快速开始

```bash
# 启动开发模式
npm run dev
# 或
npx vext dev
```

启动后，终端会显示一个 Banner 框，包含当前运行模式、监听方式、防抖间隔以及三层 Tier 图标说明：

```
╔══════════════════════════════════════════════╗
║           Vext Dev Server (Phase 2B)         ║
╠══════════════════════════════════════════════╣
║  Mode: Soft Reload + Cold Restart            ║
║  Watch: fs.watch                             ║
║  Debounce: 0ms                               ║
╠══════════════════════════════════════════════╣
║  🟢 T1 (code):   soft reload (transform)    ║
║  🟡 T2 (struct): soft reload (rebuild)      ║
║  🔴 T3 (cold):   cold restart               ║
║  ⚪ ignored:     skip                        ║
╠══════════════════════════════════════════════╣
║  r=restart  h=reload  c=clear  ?=help  ^C=quit║
╚══════════════════════════════════════════════╝
```

修改 `src/` 目录下的文件后，终端会输出变更详情和重载结果：

```
[vext dev] 1 file(s) changed:
  🟢 src/routes/users.ts (modify)
[vext dev] source change detected → soft reload [T1:code]...
[hot-reload] [OK] 45ms [T1:code] (compile:3ms cache:2ms i18n:0ms mw:5ms svc:8ms route:25ms swap:2ms) [12 modules evicted] #1
```

如果变更涉及文件新增或删除（结构变更），会走 Tier 2：

```
[vext dev] 2 file(s) changed:
  🟢 src/routes/orders.ts (add)
  🟢 src/routes/users.ts (modify)
[vext dev] source change detected → soft reload [T2:structural]...
[hot-reload] [OK] 82ms [T2:structural] (compile:35ms cache:5ms i18n:0ms mw:6ms svc:10ms route:22ms swap:4ms) [18 modules evicted] #2
```

如果变更涉及配置或插件，会走 Tier 3 冷重启：

```
[vext dev] 1 file(s) changed:
  🔴 src/config/default.ts (modify)
[vext dev] config/plugin change detected → cold restart (Tier 3)...
[vext dev] cold restart complete
```

如果 soft reload 过程中出错，框架会保持旧版本继续运行并提示修复：

```
[hot-reload] [FAIL] failed after 12ms: Cannot find module './missing.js'
[hot-reload] keeping previous version active. Fix the error and save again.
```

## 三层重载策略

VextJS 的热重载采用三层策略，根据变更文件的类型自动选择最优方式：

### Tier 1 — 路由热替换 ⚡

| 触发条件 | `src/routes/` 下的文件变更 |
|---------|--------------------------|
| 行为 | 原子替换请求处理器，零中断 |
| 速度 | 毫秒级（1-10ms） |
| 影响 | 仅变更的路由文件，其他路由不受影响 |
| 连接中断 | ❌ 不中断，正在处理的请求不受影响 |

```
修改 src/routes/users.ts
  ↓
重新 import 路由文件
  ↓
替换路由处理器（原子操作）
  ↓
新请求使用新处理器
```

Tier 1 是最快的重载方式。当你修改路由 handler 的业务逻辑时（如修改响应数据、调整查询参数），变更几乎瞬间生效，无需等待。

```typescript
// 修改这个文件 → Tier 1 热替换
// src/routes/users.ts
import { defineRoutes } from 'vextjs';

export default defineRoutes((app) => {
  app.get('/', async (_req, res) => {
    // 修改这里的代码，保存后立即生效
    res.json({ message: 'Updated response!' });
  });
});
```

### Tier 2 — 服务重载 ⚡

| 触发条件 | `src/services/` 或 `src/locales/` 下的文件变更 |
|---------|----------------------------------------------|
| 行为 | 重建受影响的服务实例 |
| 速度 | 毫秒级（5-50ms） |
| 影响 | 变更的服务及其依赖链 |
| 连接中断 | ❌ 不中断 |

```
修改 src/services/user.ts
  ↓
重新 import 服务文件
  ↓
重新实例化 UserService(app)
  ↓
更新 app.services.user 引用
  ↓
后续请求使用新服务实例
```

Tier 2 适用于服务层的业务逻辑修改。由于服务通过 `app.services` 延迟访问，替换服务实例后新请求自然会使用新的实例。

```typescript
// 修改这个文件 → Tier 2 服务重载
// src/services/user.ts
export default class UserService {
  constructor(private app: VextApp) {}

  async findAll() {
    // 修改业务逻辑，保存后新请求自动使用新逻辑
    return { items: [], total: 0 };
  }
}
```

### Tier 3 — 冷重启 🔄

| 触发条件 | `src/config/`、`src/plugins/`、`src/middlewares/` 下的文件变更 |
|---------|-------------------------------------------------------------|
| 行为 | 完整重启进程 |
| 速度 | 秒级（1-3s） |
| 影响 | 整个应用重新初始化 |
| 连接中断 | ✅ 正在处理的请求可能被中断 |

```
修改 src/config/default.ts
  ↓
检测到配置/插件/中间件变更
  ↓
优雅关闭当前进程
  ↓
重新 bootstrap 整个应用
  ↓
重新监听端口
```

配置、插件和中间件的修改会影响整个应用的行为，因此需要完整重启。框架会尽可能快地完成重启过程。

```typescript
// 修改这个文件 → Tier 3 冷重启
// src/config/default.ts
export default {
  port: 3000,
  logger: { level: 'debug' },  // 修改配置需要冷重启
};
```

## 重载策略决策表

| 变更文件 | 重载策略 | 速度 | 说明 |
|---------|---------|------|------|
| `src/routes/**` | Tier 1 | ⚡ 毫秒级 | 路由处理器原子替换 |
| `src/services/**` | Tier 2 | ⚡ 毫秒级 | 服务实例重建 |
| `src/locales/**` | Tier 2 | ⚡ 毫秒级 | 语言包重新加载 |
| `src/config/**` | Tier 3 | 🔄 秒级 | 配置影响全局，需重启 |
| `src/plugins/**` | Tier 3 | 🔄 秒级 | 插件影响全局，需重启 |
| `src/middlewares/**` | Tier 3 | 🔄 秒级 | 中间件定义变更需重启 |
| `src/types/**` | — | — | 类型文件不触发重载 |
| `package.json` | Tier 3 | 🔄 秒级 | 依赖变更需重启 |

## 与 `vext build` 的关系

`vext dev` 在开发模式下直接从 `src/` 加载 `.ts` 文件（通过 esbuild 即时编译），不需要预先执行 `vext build`。

| 命令 | 源码目录 | 编译方式 | 热重载 |
|------|---------|---------|--------|
| `vext dev` | `src/` | esbuild 即时编译 | ✅ 三层热重载 |
| `vext start` | `dist/` | 预编译（需先 `vext build`） | ❌ 无 |
| `vext build` | `src/` → `dist/` | tsc 完整编译 | — |

开发流程：

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
  --debounce <ms>      防抖间隔（毫秒，默认 0 不开启）
  --poll               强制轮询模式（Docker / NFS 环境）
  --poll-interval <ms> 轮询间隔（毫秒，默认 1000）
  --no-hot             禁用 Soft Reload，所有变更走 Cold Restart
  --clear              每次重载后清空控制台
  -h, --help           显示帮助信息
```

```bash
# 使用自定义端口
vext dev --port 8080

# 指定监听地址
vext dev --host 127.0.0.1

# 开启 50ms 防抖（快速连续保存时合并为一次重载）
vext dev --debounce 50

# Docker / NFS 环境使用轮询模式
vext dev --poll --poll-interval 2000
```

## 文件监听规则

### 监听范围

`vext dev` 默认监听 `src/` 目录下的所有文件变更：

```
src/
├── config/       → Tier 3
├── plugins/      → Tier 3
├── middlewares/   → Tier 3
├── routes/       → Tier 1
├── services/     → Tier 2
├── locales/      → Tier 2
└── types/        → 忽略（仅类型）
```

### 忽略规则

以下文件和目录的变更不会触发重载：

- `node_modules/`
- `dist/`
- `.git/`
- 测试文件：`*.test.ts`、`*.spec.ts`
- 以 `.` 开头的隐藏文件
- `*.d.ts` 类型声明文件

### 防抖处理

默认情况下防抖**未开启**（`debounce: 0`），文件变更后**立即触发**重载，响应最快。如需在快速连续保存时合并多次变更为一次重载，可通过 `--debounce <ms>` 开启防抖窗口。

例如：同时修改了 `routes/users.ts`（Tier 1）和 `config/default.ts`（Tier 3），框架会执行一次 Tier 3 冷重启（包含所有变更）。

## TypeScript 支持

`vext dev` 使用 esbuild 进行即时编译，特点如下：

- **极速编译** — esbuild 编译速度比 tsc 快 10-100 倍
- **类型擦除** — esbuild 只做语法转换，不做类型检查
- **零配置** — 自动读取 `tsconfig.json` 中的编译选项

:::warning 类型检查
`vext dev` 不会在热重载时执行类型检查（为了速度）。建议：
- 开发时依赖 IDE（VS Code / WebStorm）的实时类型检查
- 提交前运行 `npm run typecheck`（`tsc --noEmit`）进行完整类型检查
- CI 中执行 `tsc --noEmit` 确保类型正确
:::

## 常见问题

### 修改后没有触发重载？

1. **检查文件是否在 `src/` 目录下** — 只有 `src/` 目录下的文件变更才会触发重载
2. **检查是否是被忽略的文件** — `*.test.ts`、`*.d.ts`、以 `.` 开头的文件不会触发
3. **检查终端输出** — 是否有错误信息（如语法错误导致编译失败）

### 热重载后行为不符合预期？

1. **尝试手动重启** — 按 `Ctrl+C` 停止后重新运行 `vext dev`
2. **清除模块缓存** — 极少数情况下 Node.js 的模块缓存可能导致旧代码残留
3. **检查服务间依赖** — Tier 2 重载只重建变更的服务，如果其他服务在构造函数中缓存了旧引用，可能需要 Tier 3

### 冷重启太慢？

1. **减少启动时的初始化操作** — 插件的 `setup()` 中避免耗时操作（如大量数据预热），改到 `onReady()` 中
2. **开发环境跳过非必要插件** — 通过 `development.ts` 配置条件禁用某些插件
3. **使用 `local.ts` 简化配置** — 本地开发时关闭不需要的功能（如限流、访问日志等）

### 端口占用怎么办？

冷重启时如果端口释放不及时，可能遇到 `EADDRINUSE` 错误。框架内部会自动重试，通常在几百毫秒内恢复。如果持续报错：

```bash
# 手动查找并终止占用端口的进程
# macOS/Linux
lsof -i :3000

# Windows
netstat -ano | findstr :3000
```

## 与 Cluster 模式的关系

`vext dev` 不支持 Cluster 多进程模式。开发时始终以单进程运行，确保热重载行为可预测。

生产环境如需多进程，使用 `vext start` 配合 Cluster 配置：

```bash
# 开发 — 单进程 + 热重载
vext dev

# 生产 — 多进程 + 零停机重启
vext start   # 配合 cluster.enabled: true
vext reload  # 滚动重启 Worker
```

## 最佳实践

### 1. 充分利用 Tier 1/2

将大部分开发工作放在路由和服务层，享受毫秒级的热重载体验。配置和插件修改相对较少，偶尔的冷重启是可以接受的。

### 2. 配合 IDE 实时类型检查

由于 `vext dev` 不做类型检查，建议开启 IDE 的实时类型检查（VS Code 默认开启）。这样修改代码时能立即发现类型错误，同时保持热重载的极速体验。

### 3. 开发环境简化配置

通过 `development.ts` 关闭生产环境才需要的功能，加速冷重启：

```typescript
// src/config/development.ts
export default {
  rateLimit: { enabled: false },    // 开发时关闭限流
  accessLog: { enabled: false },    // 减少日志噪音
  logger: { level: 'debug' },       // 开发时使用 debug 级别
};
```

### 4. 使用 `_` 前缀共享代码

路由和服务目录中以 `_` 开头的文件不会被自动加载为路由/服务。修改这些工具文件时：

- 如果被路由文件引用 → 触发 Tier 1（因为路由模块的依赖发生了变化）
- 如果被服务文件引用 → 触发 Tier 2

```
src/routes/
├── _utils.ts          # 修改时触发使用它的路由文件重载
├── users.ts           # import { helper } from './_utils.js'
└── orders.ts
```

## 下一步

- 了解 [CLI 命令](/guide/cli) 的完整用法
- 学习 [Cluster 多进程](/guide/cluster) 的生产环境部署
- 查看 [配置](/guide/configuration) 的环境覆盖机制
- 探索 [测试](/guide/testing) 确保热重载后的代码正确性