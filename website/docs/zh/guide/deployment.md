# 部署与生产环境

本页按“准备交付物 → 启动并检查 → 接入进程管理与反向代理 → 发布和回退”说明生产部署。先完成 [CLI 最小项目流程](/zh/guide/cli#从创建到生产启动)和[构建](/zh/guide/build)，再选择适合环境的部署方式。

## 先验证一次生产启动

前置：已有 TypeScript API-only 项目，依赖已安装，脚手架的 `src/routes/index.ts` 保留 `/` 与 `/health`。在项目根目录执行：

```bash
npx vextjs build --typecheck --outdir dist
npx vextjs start --outdir dist --port 3000 --host 127.0.0.1
```

另开终端检查（Windows PowerShell 使用 `curl.exe`）：

```bash
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/health
```

预期两项均为 HTTP 200，健康响应的 `data.status` 为 `ok`。结束后在启动终端按 Ctrl+C，并确认进程退出、端口释放。换成 fullstack 脚手架时，健康路径为 `/api/health`；应用自定义后以自己的真实路径为准。框架不会给所有项目自动添加统一健康端点。

本页其余配置是按场景合并的片段，不应依次覆盖整个配置文件。容器、PM2、Nginx 和 Kubernetes 示例需要对应平台、权限及实际服务地址；完成本地启动并不代表这些平台已部署验证。

## 构建生产产物

### vext build

使用 `vext build` 刷新 generated / manifest 工具产物，并将 TypeScript 源码编译为生产级 JavaScript：

```bash
npx vextjs build --typecheck
```

未指定输出目录、环境变量或已有构建记录时，编译产物输出到 `dist/`，保留与 `src/` 对应的模块结构。本页使用固定 `dist` 的部署示例时，构建和启动均显式传入 `--outdir dist`；自定义目录则成对替换，避免启动另一份旧产物。

使用 `--typecheck` 会先刷新 `.vext/types/`、`src/types/generated/index.d.ts` 与 `.vext/manifest/`，再执行 `tsc --noEmit` 和生产编译。以下是可选业务目录的映射示意：

```text
src/                          dist/
├── config/                   ├── config/
│   ├── default.ts      →     │   ├── default.js
│   └── production.ts   →     │   └── production.js
├── routes/                   ├── routes/
│   └── users.ts        →     │   └── users.js
├── services/                 ├── services/
│   └── user.ts         →     │   └── user.js
├── plugins/                  ├── plugins/
│   └── redis.ts        →     │   └── redis.js
└── middlewares/              └── middlewares/
    └── auth.ts         →         └── auth.js
```

### 编译选项

| 选项         | 默认值                 | 说明                                           |
| ------------ | ---------------------- | ---------------------------------------------- |
| Source Map   | 开启（外部 `.js.map`） | 生成独立 map；自动关联限制见下文               |
| Minify       | 默认开启               | 压缩后端产物；仅在本地诊断时使用 `--no-minify` |
| Target       | `node20`               | 与 `engines.node ^20.19.0 \|\| >=22.12.0` 对齐 |
| Format       | CJS                    | CommonJS 输出，Node.js 稳定运行                |
| Tree Shaking | 开启                   | 消除可判定的死代码；保留独立模块导出           |
| Keep Names   | 开启                   | 保留函数/类名称（错误堆栈可读性）              |

本表描述后端编译器。前端产物采用独立的生产默认值：浏览器压缩开启、浏览器 source map 关闭，SSR renderer 压缩关闭，除非显式配置。

### 编译排除

生产编译自动排除以下文件：

- `*.d.ts` / `*.d.mts` / `*.d.cts` — 类型声明
- `*.test.*` / `*.spec.*` — 测试文件
- `__tests__/` — 测试目录
- `config/development.*` — 开发环境配置
- `config/local.*` — 本地覆盖配置
- `config/test.*` — 测试环境配置

### 编译底层

`vext build` 的后端编译阶段基于 [esbuild](https://esbuild.github.io/) 实现。实际耗时取决于项目规模、插件转换、source map 配置、文件系统与硬件；制定部署预算时请测量自己的 CI 或发布构建。

编译时会自动注入 `process.env.NODE_ENV = "production"`，因此 build 后用户源码中的环境分支会按 production 语义静态折叠；但运行时实际加载哪个配置 profile，仍按启动配置选择：显式 `--config`、`VEXT_CONFIG`、兼容的非标准 NODE_ENV 名，再到构建身份记录的 profile / production 默认值。编译后的文件必须实际存在，不能只在服务器上改一个 profile 名。

### 完整交付清单

| 项目类型            | 需要交付                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| TypeScript API-only | 完整后端输出目录（含输出 package.json、构建身份、JSON 和 preload）、根 package.json / 锁文件、生产依赖 |
| TypeScript + 前端   | 上述产物，加浏览器、SSR renderer 与全部 manifest；自定义输出目录也要复制                               |
| JavaScript API-only | 源码、配置、项目 preload、根 package.json / 锁文件及生产依赖；不要求后端 build                         |
| JavaScript + 前端   | JavaScript 源码与依赖，以及前端 build 的完整输出                                                       |

输出目录按显式 `--outdir` → `VEXT_BUILD_OUTDIR` → 项目构建记录 → `dist` 选择。交付到没有本地记录的新环境时明确传入 `--outdir`。不要只挑选 routes/services 的 JS；外部模板、上传目录、配置文件和动态读取的资源按实际路径另行交付。保留目录权限和持久数据，确保运行用户能写 PID、上传和应用状态。

后端不会打包 npm 依赖，`vextjs`、适配器及业务运行依赖须列入应用的 `dependencies`。TypeScript 的 `start` 不回退源码；JavaScript 项目仍需源码。更多边界见[部署清单](/zh/guide/build#部署清单)。

## 生产交付前端

当 `frontend.enabled` 为 true 时，`vext build` 还会将浏览器与 SSR 产物默认写入 `dist/client/`：`index.html`、带 hash 的资源、`render-manifest.json`、`deploy-manifest.json` 和默认的 `server/renderer.cjs`。后端产物仍在 `dist/` 下保持源码目录映射；不要部署一个并不存在的固定顶层 `dist/server/` 目录。

### 同源部署

先确认前端角色目录和渲染模式已配置、构建通过；同源静态资源不需要配置 CDN 地址：

```bash
npx vextjs build
npx vextjs start
```

`vext start` 会在 listen 前校验前端产物，再按配置服务静态资源和 SSR 页面。CSR 的 SPA fallback 还需配置相应 scopes；不能据此认定所有未知 URL 都自动回落到 index.html。

### CDN 部署与上传

只有确定由 CDN 承担 immutable browser assets 时才使用 CDN。设置绝对 `frontend.deploy.assetBaseUrl`，让 HTML/SSR 继续由 Node 服务提供，然后在真实上传前审阅 upload plan：

```bash
npx vextjs build
npx vextjs deploy assets --dry-run
npx vextjs deploy assets
npx vextjs start
```

`deploy-manifest.json` 包含可上传的 JS、CSS、import 型媒体与 `public/**` 文件，并带有 sha256/SRI metadata。它刻意排除 SSR HTML 与 source map。`frontend.deploy.upload.stateFile` 必须放在输出目录之外，避免普通 build 清理增量上传状态。

内置 adapter 只有 `filesystem` 与 `mock`。`filesystem` 用于生成本地 staging tree；真实云厂商需要显式 custom adapter。自定义 adapter 的依赖和上传凭据由应用显式配置。完整步骤见[构建与发布](../frontend/build-and-deploy)，全部字段见[前端配置](../frontend/configuration)。

## 启动生产服务

### 直接启动

```bash
npx vextjs start --outdir dist --port 3000 --host 0.0.0.0

# 需要在构建时纳入该 profile，再用同一 profile 启动
npx vextjs build --config sg-sit --typecheck --outdir dist
npx vextjs start --outdir dist --config sg-sit --port 3000
```

TypeScript 项目要求有效且完整的构建产物；开发用 `vext dev`。不要通过上传源码或安装 tsx 掩盖生产产物缺失。部署时固定工作目录，PID 文件和相对路径均与它有关。

### 环境变量

| 变量                            | 用途                                             |
| ------------------------------- | ------------------------------------------------ |
| `NODE_ENV`                      | `start` 子进程设为 production，表示 runtime mode |
| `VEXT_CONFIG`                   | 配置 profile，低于显式 `--config`                |
| `VEXT_PORT` / `VEXT_HOST`       | 覆盖监听地址；显式 `--port` / `--host` 优先      |
| `VEXT_BUILD_OUTDIR`             | 指定构建输出目录；显式 `--outdir` 优先           |
| `PORT` / `HOST` / `MONGODB_URL` | 应用自定义变量，只有配置主动读取时才生效         |

### 停止与超时预算

正常关闭先停止接收新流量，再等待在途请求和 onClose 清理。单应用 `shutdown.timeout` 单位为**秒**，默认 10；Cluster 的 `reload.shutdownTimeout` 单位为**毫秒**，默认 10000，外部进程管理器还应留出额外时间。以内部 10 秒、容器/PM2 30 秒为起点，并按自己的请求与连接关闭耗时调整。

Unix 上 CLI 转发 SIGINT / SIGTERM；Windows 的 CLI 信号处理走子进程 IPC，并有 15 秒兜底。Windows 外部强制结束进程不等价于触发应用 onClose。Cluster 停止、PID 定位和 SIGHUP 平台限制见[Cluster](/zh/guide/cluster)。

## Docker 部署

### Dockerfile

以下适用于默认 dist 的 TypeScript API-only 项目，无前端、外部模板或额外构建资源。构建上下文需包含应用 package.json、锁文件、tsconfig.json 和 src；如果有项目 preload 或其他构建输入，也要复制。前端项目按上一节补齐角色目录和输出。

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY tsconfig.json ./
RUN ./node_modules/.bin/vext build --typecheck --outdir dist

FROM node:22-alpine AS runner
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder --chown=node:node /app/dist ./dist
RUN chown node:node /app
USER node
ENV VEXT_PORT=3000
ENV VEXT_HOST=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
CMD ["./node_modules/.bin/vext", "start", "--outdir", "dist"]
```

健康路径对应本页 API-only 脚手架；使用 GET 而不是依赖应用支持 HEAD。exec 形式启动本地 CLI，避免 npm/shell 额外包裹影响信号传递。`EXPOSE` 仅声明端口，实际宿主映射见下方命令。

### .dockerignore

```
node_modules
dist
.vext
.git
*.md
test
website
.ai-memory
reports
```

### Docker Compose

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - VEXT_PORT=3000
      - MONGODB_URL=mongodb://mongo:27017/myapp
    stop_grace_period: 30s
    depends_on:
      mongo:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: "1.0"

  mongo:
    image: mongo:7
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: echo 'db.runCommand("ping").ok' | mongosh --quiet
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  mongo-data:
```

Compose 示例需应用主动读取数据库变量。若前层没有 database，生产配置中提供完整值，例如：

```typescript
// src/config/production.ts（与现有配置合并）
import type { VextConfigOverride } from "vextjs";

export default {
  database: {
    databaseName: "myapp",
    config: {
      uri: process.env.MONGODB_URL ?? "mongodb://127.0.0.1:27017/myapp",
    },
  },
} satisfies VextConfigOverride;
```

`depends_on: service_healthy` 处理初始启动依赖；Mongo 后续掉线仍需应用重试、就绪检查和运维处置。Mongo volume 独立于应用镜像保留。容器 healthcheck 本身不会让普通 Docker 自动重启一个仍在运行的 unhealthy 进程。参阅 [Dockerfile 健康检查](https://docs.docker.com/reference/dockerfile/#healthcheck)与 [Compose 依赖顺序](https://docs.docker.com/compose/how-tos/startup-order/)。

### 构建和运行

```bash
# 构建镜像
docker build -t myapp:latest .

# 运行容器
docker run -d \
  --name myapp \
  -p 3000:3000 \
  --stop-timeout 30 \
  -e MONGODB_URL=mongodb://host.docker.internal:27017/myapp \
  myapp:latest

# 查看日志
docker logs -f myapp
```

独立 `docker run` 的数据库地址示例适用于提供 `host.docker.internal` 的 Docker Desktop；Linux 主机需使用实际可达地址或明确配置 host-gateway。Compose 场景使用服务名 `mongo`。

## Nginx 反向代理

### 基础配置

先准备域名、证书和可达的后端端口。以下是 HTTP API 代理；确认应用真实依赖转发地址时再配置 `trustProxy`，并限制后端仅由可信代理访问。

```nginx
# /etc/nginx/conf.d/myapp.conf

upstream vext_backend {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name api.example.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    # SSL 证书
    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 请求体大小限制
    client_max_body_size 10M;

    # 代理到 VextJS
    location / {
        proxy_pass http://vext_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;

        # 超时设置
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 健康检查端点（不记录日志）
    location = /health {
        proxy_pass http://vext_backend;
        access_log off;
    }

    # 静态文件（如果有）
    location /static/ {
        alias /var/www/myapp/static/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

普通 API 请求不应统一发送 `Connection: upgrade`。仅当应用适配器实际支持并提供 WebSocket 时，另按 [Nginx WebSocket 文档](https://nginx.org/en/docs/http/websocket.html)配置条件 Upgrade；SSE 还需按实际流式接口调整 buffering / timeout。`/static/` 的 alias 是独立静态目录示例，不会自动对应 Vext 前端带 hash 的产物。

修改后先执行 `nginx -t`，通过后按部署系统重载 Nginx，并验证外部 HTTPS、转发头、上传大小及健康路径。

### 多实例负载均衡

```nginx
upstream vext_backend {
    least_conn;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
    server 127.0.0.1:3004;
    keepalive 64;
}
```

## PM2 进程管理

### 安装

```bash
npm install -g pm2
```

### ecosystem 配置文件

以下用于 Unix 主机，先创建可写日志目录，并替换 `cwd` 为实际发布目录：

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "myapp",
      cwd: "/srv/myapp/current",
      script: "node_modules/vextjs/dist/cli/index.js",
      args: "start --outdir dist --port 3000",
      exec_mode: "fork",
      instances: 1,
      env: { VEXT_HOST: "127.0.0.1" },
      error_file: "/var/log/myapp/error.log",
      out_file: "/var/log/myapp/out.log",
      merge_logs: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 5000,
      kill_timeout: 30000,
    },
  ],
};
```

PM2 管理的是 Vext CLI 父进程，业务在其子进程或 Cluster Worker 中。不要把 PM2 的 CPU/内存指标直接当作所有 Worker 指标；为业务进程和容器单独监控。

保留 PM2 默认 SIGINT 关闭路径。不要设置 `shutdown_with_message: true`：它发送字符串 `"shutdown"`，当前 CLI 没有对应处理器。详见 [PM2 关闭机制](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/)和[配置字段](https://pm2.keymetrics.io/docs/usage/application-declaration/)。

### PM2 常用命令

```bash
# 启动
pm2 start ecosystem.config.cjs

# 查看状态
pm2 status

# 查看日志
pm2 logs myapp

# 重启
pm2 restart myapp

# fork 模式重载不能保证无中断，发布前先验证健康与连接行为
pm2 reload myapp

# 停止
pm2 stop myapp

# 监控面板
pm2 monit

# 设置开机自启
pm2 startup
pm2 save
```

:::tip VextJS Cluster vs PM2 Cluster
VextJS 通过配置 `cluster.enabled: true` 或环境变量 `VEXT_CLUSTER=1` 启用内置 Cluster，由 `cluster.workers` 指定 Worker 数量；`start` 不支持 `--cluster` 或 `--workers` 参数。使用内置 Cluster 时保持 PM2 的 `instances: 1`，由 VextJS 管理 Worker；滚动替换仍受下文平台与就绪条件限制。

详见 [Cluster 多进程](/zh/guide/cluster)。
:::

PM2 的 fork 单实例示例不提供多实例滚动保障。使用 Vext Cluster 时仍保持外层单实例；SIGHUP reload 需要指向 Vext Master 的 PID，不能假定 PM2 reload 会自动调用 Vext 的滚动协议。共享 Session、限流和连接池须另外配置。

## 日志收集

### JSON 日志格式

生产应用日志明确配置 `pretty: false` 后输出逐行 JSON。CLI 启动提示可能与 JSON 同流，采集器需区分；不要再由 PM2 添加行首时间戳破坏 JSON。以下为使用默认 ISO 时间戳的示意字段，实际请求日志格式见[日志](/zh/guide/logger)与[访问日志](/zh/api/access-log)：

```json
{
  "level": 30,
  "time": "2026-03-05T14:23:05.123Z",
  "requestId": "abc-123",
  "msg": "→ GET /api/users 200 45ms"
}
```

### 配置日志级别

```typescript
// src/config/production.ts
export default {
  logger: {
    level: "info", // 生产环境建议 info（不输出 debug）
    pretty: false, // 生产环境禁用 pretty（默认行为）
    prettyColor: "never", // 可选：显式禁止 pretty ANSI
  },
};
```

### 日志收集方案

#### 方案一：文件 + Filebeat → ELK

```bash
# PM2 输出日志到文件
pm2 start ecosystem.config.cjs

# Filebeat 采集日志文件 → Elasticsearch → Kibana
```

```yaml
# filebeat.yml
filebeat.inputs:
  - type: filestream
    id: myapp-json
    paths:
      - /var/log/myapp/*.log
    parsers:
      - ndjson:
          target: ""
          add_error_key: true

output.elasticsearch:
  hosts: ["http://elasticsearch:9200"]
```

此片段使用 [Filebeat filestream / ndjson](https://www.elastic.co/docs/reference/beats/filebeat/filebeat-input-filestream)。采集混合启动文本时处理解析失败事件，并补充实际认证、索引策略和日志轮转；原 `log` input 已弃用，不宜作为新配置起点。

#### 方案二：Docker 日志 → Loki

Docker 主机须先按 [Loki Docker driver 文档](https://grafana.com/docs/loki/latest/send-data/docker-driver/)安装并配置驱动；下面片段只声明使用它，不会部署 Loki 或安装驱动。

```yaml
# docker-compose.yml
services:
  app:
    build: .
    logging:
      driver: loki
      options:
        loki-url: "http://loki:3100/loki/api/v1/push"
        loki-batch-size: "400"
```

#### 方案三：stdout → Cloud 原生

在 Kubernetes / AWS ECS / Cloud Run 等平台中，直接输出到 stdout，由平台自动收集：

```bash
# 不需要额外配置，JSON 日志直接输出到 stdout
npx vextjs start
```

## 健康检查

### 实现健康检查端点

脚手架已有 `/health` 时，**替换原处理器**，不要重复注册。在 `src/routes/index.ts` 中保留业务路由并合并：

```typescript
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/health",
    { override: { rateLimit: false }, docs: { summary: "进程存活" } },
    async (_req, res) => {
      res.json({ status: "ok", uptime: process.uptime(), pid: process.pid });
    },
  );

  app.get(
    "/ready",
    { override: { rateLimit: false }, docs: { summary: "是否可接收业务流量" } },
    async (_req, res) => {
      // 本例是没有外部依赖的 API；有关键依赖时在这里检查真实可用性。
      res.json({ status: "ready" });
    },
  );
});
```

`index.ts` 不增加文件名前缀；若拆成 `health.ts`，其中应注册 `"/"`，否则 `"/health"` 会成为 `/health/health`。默认响应包装使状态位于 `data.status`。全局认证、中间件或缓存也应为探针设置实际需要的放行规则，关闭限流不能自动绕过它们。

- **Liveness**：判断进程能否响应；不要让短暂数据库故障触发所有实例反复重启。
- **Readiness**：判断关键业务依赖是否可用；失败返回 503，恢复返回 200。只判断 `app.db !== undefined` 不能证明数据库仍可用。使用数据库时可通过已初始化的 `req.app.db.client` 执行真实 ping，并设置依赖超时；按[数据库](/zh/guide/database)准备连接。
- **Cluster**：一次 HTTP 探针只命中一个 Worker。`vext status` 固定请求 `/health`，也不代替多 Worker、外部依赖和业务探针，其退出码 0 不能作为部署健康门禁。

验证 200 路径后，还应人为使关键依赖不可用，确认 readiness 返回 503、实例退出流量；恢复后复验。

### Kubernetes 探针配置

```yaml
# Deployment 中 spec.template 的片段
spec:
  terminationGracePeriodSeconds: 30
  containers:
    - name: myapp
      image: myapp:latest
      ports:
        - containerPort: 3000
      livenessProbe:
        httpGet:
          path: /health
          port: 3000
        initialDelaySeconds: 10
        periodSeconds: 30
        timeoutSeconds: 5
      readinessProbe:
        httpGet:
          path: /ready
          port: 3000
        initialDelaySeconds: 5
        periodSeconds: 10
        timeoutSeconds: 3
      resources:
        requests:
          memory: "128Mi"
          cpu: "250m"
        limits:
          memory: "512Mi"
          cpu: "1000m"
```

该片段放入 Deployment 的 `spec.template`；完整资源仍需 metadata、selector、replicas 和镜像拉取配置。依据实际启动时间考虑 startupProbe；配合多副本、就绪状态与终止宽限处理发布摘流，不能仅因存在 readinessProbe 就宣称零中断。探针语义见 [Kubernetes 官方说明](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)。

## 异常崩溃通知（onFatalError）

VextJS 内置了进程级异常捕获机制，当发生 `uncaughtException` 或 `unhandledRejection` 时，框架会：

1. 记录 `fatal` 级别日志
2. 调用用户配置的 `onFatalError` 回调（如有）
3. 执行优雅关闭（onClose hooks 清理资源）
4. `process.exit(1)` 退出进程

### 配置 onFatalError

在 `shutdown` 配置中添加 `onFatalError` 回调，接入告警通知：

```typescript
// src/config/production.ts
import type { VextConfigOverride } from "vextjs";

export default {
  shutdown: {
    timeout: 10, // 秒；关闭预算与告警回调等待分开
    onFatalError: async (error, origin) => {
      // origin: 'uncaughtException' | 'unhandledRejection'

      // 示例：发送钉钉 Webhook
      await fetch("https://oapi.dingtalk.com/robot/send?access_token=xxx", {
        method: "POST",
        signal: AbortSignal.timeout(3000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: {
            title: "⚠️ 服务异常",
            text: [
              "## ⚠️ 服务异常崩溃",
              `- **服务**: my-service`,
              `- **来源**: ${origin}`,
              `- **错误**: ${error.message}`,
              `- **时间**: ${new Date().toISOString()}`,
              `- **堆栈**:\n\`\`\`\n${error.stack}\n\`\`\``,
            ].join("\n"),
          },
        }),
      });
    },
  },
} satisfies VextConfigOverride;
```

替换为自己的 Webhook 地址；通知格式和权限由目标服务决定，以下各片段替换同一个 onFatalError 回调。外部请求应设置超时并检查响应，不应把 HTTP 非 2xx 当作发送成功。

### 企业微信 Webhook 示例

```typescript
onFatalError: async (error, origin) => {
  await fetch('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx', {
    method: 'POST',
    signal: AbortSignal.timeout(3000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        content: [
          `## <font color="warning">服务异常崩溃</font>`,
          `> 服务: my-service`,
          `> 来源: ${origin}`,
          `> 错误: ${error.message}`,
          `> 时间: ${new Date().toISOString()}`,
        ].join('\n'),
      },
    }),
  });
},
```

### Slack Webhook 示例

```typescript
onFatalError: async (error, origin) => {
  await fetch('https://hooks.slack.com/services/T00/B00/xxx', {
    method: 'POST',
    signal: AbortSignal.timeout(3000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `🚨 *Service Crash* (${origin})\nError: ${error.message}\nTime: ${new Date().toISOString()}`,
    }),
  });
},
```

### 通用 HTTP Webhook 示例

```typescript
onFatalError: async (error, origin) => {
  await fetch(process.env.ALERT_WEBHOOK_URL!, {
    method: 'POST',
    signal: AbortSignal.timeout(3000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: 'my-service',
      runtimeMode: process.env.NODE_ENV,
      configProfile: process.env.VEXT_CONFIG,
      origin,
      error: error.message,
      stack: error.stack,
      hostname: require('os').hostname(),
      pid: process.pid,
      time: new Date().toISOString(),
    }),
  });
},
```

### 注意事项

| 项目         | 说明                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------ |
| **超时保护** | `onFatalError` 最多等待回调 10 秒，再进入 shutdown；不是总退出上限，也不自动取消回调中的网络请求 |
| **错误隔离** | 回调内部抛出的异常会被捕获并记录，不会阻止进程退出                                               |
| **不可恢复** | `uncaughtException` 后进程处于不确定状态，回调应尽量轻量（发通知即可）                           |
| **测试模式** | `_testMode` 下不注册致命错误处理器，避免干扰测试                                                 |
| **配合 PM2** | PM2 自身也有重启通知能力（`pm2-slack` 等插件），可与 `onFatalError` 配合使用                     |

:::tip 为什么不能用中间件实现？
`uncaughtException` 和 `unhandledRejection` 发生在 HTTP 中间件执行链之外（例如定时任务、事件监听器中的异常），中间件无法捕获这类错误。因此必须在框架 bootstrap 层注册 `process` 级事件监听器。
:::

## 安全加固

### 生产环境清单

| #   | 检查项               | 说明                                                                                       |
| --- | -------------------- | ------------------------------------------------------------------------------------------ |
| 1   | **HTTPS**            | 按部署架构选择 Nginx/CDN 等 TLS 终结位置                                                   |
| 2   | **CORS**             | 配置 `config.cors` 限制允许的来源域名                                                      |
| 3   | **限流**             | 配置 `config.rateLimit`，对登录等敏感接口设更严格限流                                      |
| 4   | **Security Headers** | 配置 `config.securityHeaders`，启用低破坏默认头，并按需选择 strict/custom 浏览器安全响应头 |
| 5   | **环境变量**         | 按项目策略选择环境变量、配置文件或密钥服务；确认实际注入来源                               |
| 6   | **config/local.ts**  | 确保 `.gitignore` 中包含 `config/local.*`                                                  |
| 7   | **日志**             | 不输出敏感数据（密码、token 等）到日志                                                     |
| 8   | **依赖审计**         | 定期 `npm audit`，及时修复已知漏洞                                                         |
| 9   | **非 root**          | Docker 容器中使用非 root 用户运行                                                          |
| 10  | **优雅关闭**         | 确保 `SIGTERM` 信号被正确处理（VextJS 内置支持）                                           |

### 环境变量管理

VextJS 不会自动解析 `.env` 文件，也不内置隐式 dotenv loader。代码通过
`process.env` 读取的值，必须由操作系统、shell、进程管理器、容器平台、CI/CD、
密钥管理服务或应用显式拥有的 loader 注入。脚手架仍会忽略 `.env*` 文件，以降低
外部工具创建这些文件后被误提交的风险；这项 Git 防护不表示 Vext 会加载它们。

```bash
# 由 shell 或 CI 为单个进程注入
VEXT_PORT=3000 MONGODB_URL=mongodb://localhost:27017/myapp npm start

# 由容器/平台注入
docker run -e MONGODB_URL=mongodb://mongo:27017/myapp myapp
# Kubernetes：Secret + ConfigMap
```

## 性能优化

### Node.js 参数

```bash
# 按真实工作负载设置 V8 old-space 上限，单位 MiB
NODE_OPTIONS=--max-old-space-size=4096 npx vextjs start

# POSIX shell 示例；PowerShell 用 $env:NODE_OPTIONS 设置
```

Node 默认堆上限取决于版本、平台和可用内存，不是固定 1.5GB。该参数限制 V8 old-space，不等于进程 RSS 或整个容器内存。

### Source Map

后端 build 默认生成 `.js.map`，但采用 esbuild `external` 模式，不写入 `sourceMappingURL`。因此仅设置 `NODE_OPTIONS=--enable-source-maps` **不能保证当前产物的堆栈映射回 TypeScript**。需由实际诊断平台关联 JS 和 map，并验证异常样本；详见[构建的 Source Map 边界](/zh/guide/build#source-map)。

### Cluster 多进程

在已有生产配置中合并以下设置，再构建并启动。固定数量先以实际 CPU、内存和连接池预算验证；如使用 `"auto"`，框架按检测到的可用 CPU 数计算，上限 64。

```typescript
// src/config/production.ts（与现有配置合并）
import type { VextConfigOverride } from "vextjs";

export default {
  cluster: { enabled: true, workers: 4 },
} satisfies VextConfigOverride;
```

```bash
npx vextjs build --typecheck --outdir dist
npx vextjs start --outdir dist --port 3000
```

详见 [Cluster 多进程](/zh/guide/cluster)。

### 连接池优化

```typescript
// src/config/production.ts
export default {
  // 请求超时和重试预算（不是连接池大小）
  fetch: {
    timeout: 5000, // 生产环境缩短超时
    retry: 2, // 幂等方法自动重试
  },

  // 数据库连接池
  database: {
    databaseName: "myapp",
    config: {
      uri: process.env.MONGODB_URL ?? "mongodb://127.0.0.1:27017/myapp",
      options: {
        maxPoolSize: 20,
        minPoolSize: 5,
        maxIdleTimeMS: 30000,
      },
    },
  },
};
```

每个 Worker 各建连接池，最大连接预算按“池上限 × Worker × 副本”估算，另计监控和其他进程。fetch 重试只适用于实现支持的幂等方法与可重放请求，还应计入每次尝试超时和退避的总耗时；详见[HTTP 客户端](/zh/guide/fetch)。

## 部署流程建议

### CI/CD 流水线

```
Push to main
  → CI 检查（lint + typecheck + test）
  → vext build（编译）
  → Docker build（构建镜像）
  → Push to Registry
  → Deploy（Rolling Update）
  → Health Check（验证）
```

### 灰度发布

1. 构建带唯一版本标签的镜像，保留当前版本及与其配套的配置。
2. 在新端口或副本部署新版本，直接验证真实 health、ready 和业务请求。
3. 校验并重载代理配置，按权重引入流量；权重表示调度比例，不保证每十次请求恰好一次灰度。
4. 观察错误、延迟、依赖负载和会话兼容；通过后扩大流量，失败则切回旧实例。
5. 摘除旧实例后等待在途请求和长连接，再关闭旧进程。数据库结构变更须有自己的兼容和回退策略。

```bash
docker build -t myapp:v1.2.0 .
docker run -d --name myapp-canary -p 3001:3000 --stop-timeout 30 myapp:v1.2.0
curl -i http://127.0.0.1:3001/health
```

应用需要数据库时，同步传入上文实际连接配置。下面片段替换 Nginx 的 upstream：

```nginx
upstream vext_backend {
    server 127.0.0.1:3000 weight=9;
    server 127.0.0.1:3001 weight=1;
}
```

Vext Cluster reload 不更新 Master 自身配置，也不会替你发布镜像、切换数据结构或保证全部长连接无损。当前 `sticky: "ip"` 未实现 IP 到 Worker 的粘性映射；全部 Worker 死亡也不能依赖 Master 自动退出触发 PM2 重启。用外部健康检查、容量告警和明确恢复流程覆盖这些边界。

## 监控告警

### 关键监控指标

下表仅是制定告警的起点，按业务 SLO、基线和资源限额调整；不是框架默认指标或性能保证。

| 指标          | 正常范围    | 告警条件          |
| ------------- | ----------- | ----------------- |
| 响应时间 P99  | < 500ms     | > 1s 持续 5 分钟  |
| 错误率（5xx） | < 0.1%      | > 1% 持续 1 分钟  |
| 内存使用      | < 80% limit | > 90% 持续 5 分钟 |
| CPU 使用      | < 70%       | > 90% 持续 5 分钟 |
| 活跃连接数    | < 1000      | > 5000            |
| 数据库连接池  | 无等待      | 等待时间 > 1s     |

### Prometheus 指标端点

按 [OpenTelemetry 接入示例](/zh/examples/opentelemetry) 初始化真实 Prometheus Exporter，配置采集器访问它实际监听的端口与路径。普通 `res.json()` 响应不提供 Prometheus 指标，不能作为 exporter 的替代。

## 多服务的共享资源边界

每个服务使用自己的 cwd、配置 profile、业务端口、生成目录和持久数据目录。不同端口不会隔离同域 Cookie；按实际共享意图选择 cookie 名、path/domain 和 Session store namespace。需要独立会话时显式配置隔离，不能只改端口。

响应缓存、MonSQLize 查询缓存、Session 与限流存储是不同的系统。共享 Redis/数据库前核对 key prefix/namespace、TTL 单位和失效范围；框架不擅自重命名用户配置。连接预算按每进程池上限 × worker 数 × 服务数计算，再加独立 pools/代理；外部真实上限需要部署证据。

同进程多 app 的 Model 注册按 owner 维护：相同定义可共享；不同定义抢同一 key 在注册前失败；关闭只释放本 app 的引用。库/池选择与注册 key 不同，详见[数据库](/zh/guide/database)。多进程各自有注册表，外部数据库和缓存仍可能共享。

## 部署 Job scheduler 与 worker

Job scheduler 和 worker 使用独立于 HTTP 的进程。用 `npx vextjs job scheduler` 创建定时 run，用 `npx vextjs job worker` 领取和执行 pending run。分别配置 cwd、profile、持久存储、日志和关闭策略；HTTP rolling restart 不会代替它们重启。详见[任务与 Jobs](/zh/guide/jobs)。

## 文档站发布

维护 VextJS 仓库本身时，文档站由 `.github/workflows/docs.yml` 发布到 [GitHub Pages](https://devcodex-labs.github.io/vextjs/)，base path 为 `/vextjs/`。自动发布跟随 main 的成功 push CI，检出对应精确 SHA；它与上文业务应用部署是两套流程。DevCodex Labs 组织主页由独立仓库维护。

## 下一步

- 了解 [Cluster 多进程](/zh/guide/cluster) 充分利用多核 CPU
- 查看 [OpenTelemetry 接入](/zh/examples/opentelemetry) 实现完整的可观测性
- 学习 [Nacos 接入](/zh/examples/nacos-integration) 实现微服务注册发现
- 探索 [配置](/zh/guide/configuration) 中的环境配置覆盖机制
