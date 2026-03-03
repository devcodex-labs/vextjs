# Hello World 示例

> VextJS 框架最小化示例项目，演示基本的路由、配置和两种启动模式。

---

## 📁 项目结构

```
hello-world/
├── src/
│   ├── config/
│   │   └── default.js      # 应用配置（端口、日志、OpenAPI 等）
│   └── routes/
│       └── index.js         # 路由定义（GET / + GET /health）
├── node_modules/
│   └── vextjs -> ../../     # symlink 指向框架根目录（monorepo 内使用）
├── package.json             # 项目配置（type: module）
├── start.js                 # 生产模式启动脚本（monorepo 内使用）
└── README.md                # 本文件
```

> 💡 **Monorepo 说明**：`node_modules/vextjs` 是指向框架根目录的 symlink（junction），
> 使示例中的 `import { ... } from 'vextjs'` 能正确解析。真实用户项目通过 `npm install vextjs` 安装，无需手动创建。

---

## 🚀 启动方式

### 生产模式（`vext start`）

生产模式使用编译后的代码运行，适用于部署环境。

**方式 1 — CLI 命令（推荐）：**

```bash
# 在用户项目中
npx vext start
npx vext start --port 8080
npx vext start --host 127.0.0.1 --port 3000
```

**方式 2 — 代码调用：**

```js
import { bootstrap } from 'vextjs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const result = await bootstrap(__dirname)
console.log(`Server started on http://${result.serverHandle.host}:${result.serverHandle.port}`)
```

**方式 3 — 本示例（monorepo 内部）：**

```bash
# 先确保框架已构建
cd vext
npm run build

# 运行示例
node examples/hello-world/start.js
```

---

### 开发模式（`vext dev`）

开发模式提供文件监听和热重载，适用于日常开发。

**方式 1 — CLI 命令（推荐，真实用户项目）：**

```bash
# 在用户项目中（已 npm install vextjs）
npx vext dev

# 常用选项
npx vext dev --poll                # Docker / NFS 环境下使用轮询模式
npx vext dev --poll-interval 2000  # 自定义轮询间隔（毫秒）
npx vext dev --debounce 200        # 自定义防抖间隔（毫秒）
npx vext dev --no-hot              # 禁用 Soft Reload，所有变更走 Cold Restart
npx vext dev --clear               # 每次重载后清空控制台
```

**方式 2 — 直接运行 dev-entry（monorepo 内部）：**

```bash
# 先确保框架已构建
cd vext
npm run build

# 通过环境变量指定项目根目录，直接运行 dev-entry.js
cd examples/hello-world
VEXT_ROOT=$(pwd) VEXT_DEV_MODE=1 NODE_ENV=development node ../../dist/lib/dev/dev-entry.js
```

> 💡 monorepo 内不能直接用 `npx vext dev`，因为 CLI 的 `detectProject` 会沿目录树向上查找 `package.json`，
> 需要 hello-world 有自己的 `package.json` + `node_modules/vextjs` symlink（已配置）。

**三层重载策略：**

| Tier | 触发条件 | 动作 | 速度 |
|------|---------|------|------|
| T1 | 代码修改（modify） | Soft Reload — `esbuild.transform()` 热替换 | ⚡ 毫秒级 |
| T2 | 文件新增 / 删除 | Soft Reload — `esbuild ctx.rebuild()` 重建 | ⚡ 毫秒级 |
| T3 | 配置 / 插件 / `.env` 变更 | Cold Restart — kill + fork 重启子进程 | 🔄 秒级 |

**键盘快捷键（开发模式下可用）：**

| 按键 | 功能 |
|------|------|
| `r` | 手动 Cold Restart |
| `h` | 手动 Soft Reload（全量） |
| `c` | 清空控制台 |
| `?` | 显示帮助 |
| `Ctrl+C` | 退出开发服务器 |

---

## 🔍 验证

启动后可通过以下请求验证：

```bash
# 主页
curl http://localhost:3000/
# → {"code":0,"data":{"message":"hello world"}}

# 健康检查
curl http://localhost:3000/health
# → {"code":0,"data":{"status":"ok","uptime":1.23}}

# OpenAPI 文档
curl http://localhost:3000/openapi.json
# → {"openapi":"3.1.0","info":{...},"paths":{"/":...，"/health":...}}
```

---

## ⚙️ 配置说明

`src/config/default.js` 仅覆盖了关心的字段，其他字段由框架 `DEFAULT_CONFIG` 自动补全：

```js
export default {
  port: 3000,           // 监听端口
  host: '0.0.0.0',      // 监听地址
  logger: {
    level: 'info',      // 日志级别
  },
  response: {
    hideInternalErrors: false,  // 开发时显示完整错误信息
  },
  openapi: {
    enabled: true,       // 启用 OpenAPI 文档
  },
}
```

框架自动补全的默认值包括：`requestId`、`cors`、`bodyParser`、`rateLimit`、`accessLog` 等，
无需手动声明即可使用内置中间件的默认行为。

---

## 📝 路由说明

`src/routes/index.js` 使用 `defineRoutes` 定义路由：

```js
import { defineRoutes } from 'vextjs'

export default defineRoutes((app) => {
  // 三段式路由：path, options, handler
  app.get('/', {}, async (req, res) => {
    res.json({ message: 'hello world' })
  })

  app.get('/health', {}, async (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() })
  })
})
```

路由文件放在 `src/routes/` 目录下会被自动扫描加载，文件路径即路由前缀：

| 文件路径 | 路由前缀 |
|---------|---------|
| `src/routes/index.js` | `/` |
| `src/routes/users.js` | `/users` |
| `src/routes/api/posts.js` | `/api/posts` |

---

## 📚 更多信息

- [VextJS README](../../README.md) — 框架完整文档
- [VextJS CLI 帮助](../../README.md#-cli-命令) — 所有 CLI 命令说明