# Deployment and production environment

This page follows the production path: prepare deliverables, start and check the service, connect a process manager and reverse proxy, then release or roll back. First complete the [CLI project workflow](/guide/cli#from-project-creation-to-production-startup) and [Build](/guide/build), then choose the deployment method for your environment.

## Verify one production start

Prerequisites: a TypeScript API-only project with dependencies installed and the scaffold's `src/routes/index.ts` retaining `/` and `/health`. In the project root, run:

```bash
npx vextjs build --typecheck --outdir dist
npx vextjs start --outdir dist --port 3000 --host 127.0.0.1
```

In another terminal, check both endpoints (use `curl.exe` in Windows PowerShell):

```bash
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/health
```

Both should return HTTP 200, and the health response should contain `data.status: "ok"`. Press Ctrl+C in the server terminal, then confirm the process exits and releases the port. The fullstack scaffold uses `/api/health`; use your actual route if you changed it. The framework does not automatically add one universal health endpoint to every project.

The remaining configurations are scenario-specific fragments; do not paste them sequentially over an entire config file. Docker, PM2, Nginx and Kubernetes examples require their corresponding platforms, permissions and real service addresses. A successful local start does not verify those deployments.

## Build production output

### `vext build`

`vext build` refreshes generated and manifest tooling artifacts and compiles TypeScript sources to production JavaScript:

```bash
npx vextjs build --typecheck
```

Without an explicit output directory, environment override or existing build record, output goes to `dist/` and retains the source module layout. Examples on this page that use `dist` explicitly pass `--outdir dist` to both build and start. If you customize it, change both commands to avoid starting stale output.

`--typecheck` refreshes `.vext/types/`, `src/types/generated/index.d.ts` and `.vext/manifest/`, then runs `tsc --noEmit` and production compilation. This mapping illustrates optional business directories:

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

### Compiler options

| Option       | Default                 | Meaning                                                              |
| ------------ | ----------------------- | -------------------------------------------------------------------- |
| Source Map   | On (external `.js.map`) | Emits separate maps; see automatic stack mapping limits below        |
| Minify       | On                      | Minifies backend output; use `--no-minify` for local diagnostics     |
| Target       | `node20`                | Matches `engines.node ^20.19.0 \|\| >=22.12.0`                       |
| Format       | CJS                     | CommonJS output                                                      |
| Tree Shaking | On                      | Removes detectable dead code while retaining separate module exports |
| Keep Names   | On                      | Retains function and class names for readable stacks                 |

This table describes the backend compiler. The frontend has separate production defaults: browser minification on, browser source maps off, and SSR renderer minification off unless configured.

### Compile exclusions

Production compilation excludes:

- `*.d.ts`, `*.d.mts`, `*.d.cts` declaration files
- `*.test.*` and `*.spec.*` test files
- `__tests__/` directories
- `config/development.*`, `config/local.*` and `config/test.*`

### Compiler implementation

The backend build stage uses [esbuild](https://esbuild.github.io/). Time depends on project size, plugins, source maps, filesystem and hardware. Measure your own CI or release build when setting a deployment budget.

Compilation injects `process.env.NODE_ENV = "production"`, so source branches using that expression fold under production semantics. The runtime config profile is still chosen at startup: explicit `--config`, `VEXT_CONFIG`, compatible nonstandard `NODE_ENV`, then the build identity profile or production default. The corresponding compiled file must exist; changing only a profile name on the server is insufficient.

### Complete delivery checklist

| Project type             | Deliver                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript API-only      | Complete backend output (including output `package.json`, build identity, JSON and preload), root `package.json` and lockfile, production dependencies |
| TypeScript with frontend | Backend output plus browser, SSR renderer and all manifests, including when the output directory is customized                                         |
| JavaScript API-only      | Sources, config, project preload, root `package.json` and lockfile, production dependencies; backend build is not required                             |
| JavaScript with frontend | JavaScript sources and dependencies plus complete frontend build output                                                                                |

Output directory selection is explicit `--outdir`, then `VEXT_BUILD_OUTDIR`, then project build record, then `dist`. Pass `--outdir` explicitly in a new deployment environment with no local record. Do not copy only route and service JavaScript. Deliver external templates, upload directories, configuration and dynamically read resources at their actual paths. Preserve directory permissions and persistent data so the runtime user can write PID, uploads and app state.

The backend does not bundle npm dependencies. Put `vextjs`, adapters and business runtime dependencies in the application's `dependencies`. TypeScript `start` does not fall back to source; JavaScript projects still need source. See the [deployment manifest](/guide/build#deployment-manifest) for more boundaries.

## Deliver the frontend in production

When `frontend.enabled` is true, `vext build` also writes the browser and SSR output to `dist/client/`: `index.html`, hashed assets, `render-manifest.json`, `deploy-manifest.json` and the default `server/renderer.cjs`. Backend output retains the source directory layout under `dist/`; there is no fixed top-level `dist/server/` to deploy.

### Same-origin deployment

First configure frontend role directories and render mode and confirm the build passes. Same-origin static assets do not need a CDN URL:

```bash
npx vextjs build
npx vextjs start
```

`vext start` validates frontend output before listening, then serves static assets and SSR pages according to configuration. CSR SPA fallback additionally requires configured scopes; unknown URLs do not all automatically return `index.html`.

### CDN deployment and upload

Use a CDN only when it will own immutable browser assets. Set an absolute
`frontend.deploy.assetBaseUrl`, keep HTML/SSR on the Node service, then review
the upload plan before executing it:

```bash
npx vextjs build
npx vextjs deploy assets --dry-run
npx vextjs deploy assets
npx vextjs start
```

`deploy-manifest.json` contains uploadable JS, CSS, imported media, and
`public/**` files with sha256/SRI metadata. It deliberately excludes SSR HTML
and source maps. Keep `frontend.deploy.upload.stateFile` outside the output
directory so an ordinary build cannot erase incremental-upload state.

Only `filesystem` and `mock` adapters are built in. `filesystem` creates a local staging tree; a real cloud provider requires an explicit custom adapter and application-configured dependencies and credentials. See [Build and Deploy](../frontend/build-and-deploy) for the full sequence and [Frontend Configuration](../frontend/configuration) for every field.

## Start production service

### Start directly

```bash
npx vextjs start --outdir dist --port 3000 --host 0.0.0.0

# Include this profile in the build, then select it at startup.
npx vextjs build --config sg-sit --typecheck --outdir dist
npx vextjs start --outdir dist --config sg-sit --port 3000
```

TypeScript projects require complete, valid build output; use `vext dev` during development. Do not hide missing production output by uploading source or installing `tsx`. Keep a fixed working directory when deploying: PID files and relative paths depend on it.

### Environment variables

| Variable                        | Purpose                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| `NODE_ENV`                      | `start` sets the child process to production runtime mode       |
| `VEXT_CONFIG`                   | Config profile, lower priority than explicit `--config`         |
| `VEXT_PORT` / `VEXT_HOST`       | Listen address; explicit `--port` / `--host` take priority      |
| `VEXT_BUILD_OUTDIR`             | Build output directory; explicit `--outdir` takes priority      |
| `PORT` / `HOST` / `MONGODB_URL` | Application variables, effective only if your config reads them |

### Shutdown and timeout budget

On graceful shutdown, stop accepting traffic, then wait for in-flight requests and `onClose` cleanup. Single-app `shutdown.timeout` is in **seconds**, default 10. Cluster `reload.shutdownTimeout` is in **milliseconds**, default 10000. Allow extra time in the external process manager; internal 10 seconds and container or PM2 30 seconds are starting points to adjust against real request and connection behavior.

On Unix, the CLI forwards SIGINT and SIGTERM. On Windows it uses child-process IPC for signals with a 15-second fallback. Forcibly killing a Windows process does not invoke application `onClose`. See [Cluster](/guide/cluster) for Cluster shutdown, PID and SIGHUP platform limits.

## Docker deployment

### Dockerfile

This Dockerfile is for a TypeScript API-only project with default `dist`, without frontend, external templates or additional build resources. The build context needs the app's `package.json`, lockfile, `tsconfig.json` and `src`. Copy project preload or other build inputs if present. For frontend projects, include the role directories and output described above.

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

The health route belongs to this page's API-only scaffold. Use GET rather than assuming HEAD support. Exec-form CLI startup avoids an extra npm/shell wrapper affecting signal delivery. `EXPOSE` only declares the port; publish it with the runtime command below.

### `.dockerignore`

```text
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

The application must explicitly read the database variable. If no earlier config layer defines `database`, provide the complete value in production config, for example:

```typescript
// src/config/production.ts (merge with existing config)
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

`depends_on: service_healthy` handles initial ordering. If Mongo becomes unavailable later, the app still needs retries, readiness checks and operational recovery. Keep the Mongo volume outside the app image. A container healthcheck alone does not make ordinary Docker restart an unhealthy process that is still running. See [Dockerfile health checks](https://docs.docker.com/reference/dockerfile/#healthcheck) and [Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/).

### Build and run

```bash
docker build -t myapp:latest .

docker run -d \
  --name myapp \
  -p 3000:3000 \
  --stop-timeout 30 \
  -e MONGODB_URL=mongodb://host.docker.internal:27017/myapp \
  myapp:latest

docker logs -f myapp
```

The standalone `docker run` database address assumes Docker Desktop provides `host.docker.internal`. Linux hosts need an actually reachable address or explicit host-gateway setup. Compose uses the `mongo` service name.

## Nginx reverse proxy

### Basic configuration

Prepare the domain, certificate and reachable backend port. This example proxies an HTTP API. Enable `trustProxy` only when the application needs forwarded addresses, and restrict backend access to trusted proxies.

```nginx
# /etc/nginx/conf.d/myapp.conf

upstream vext_backend {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name api.example.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    # SSL Certificate
    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    # SSL security configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Request body size limit
    client_max_body_size 10M;

    # Proxy to VextJS
    location / {
        proxy_pass http://vext_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;

        # Timeout setting
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

    }

    # Health check endpoint (no logging)
    location = /health {
        proxy_pass http://vext_backend;
        access_log off;
    }

    # Static files (if any)
    location /static/ {
        alias /var/www/myapp/static/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

Ordinary API requests should not all send `Connection: upgrade`. Configure conditional Upgrade only if your adapter actually supports WebSocket; see the [Nginx WebSocket guide](https://nginx.org/en/docs/http/websocket.html). Streaming SSE endpoints also need their own buffering and timeout settings. The `/static/` alias is a separate static directory example and does not automatically correspond to Vext's hashed frontend assets.

After editing, run `nginx -t`, reload Nginx only if it passes, and check external HTTPS, forwarded headers, upload limits and the actual health route.

### Multi-instance load balancing

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

## PM2 process management

### Installation

```bash
npm install -g pm2
```

### Ecosystem configuration

This example targets a Unix host. Create the writable log directory first and replace `cwd` with your real release directory:

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

PM2 manages the Vext CLI parent process; application work runs in its child process or Cluster Workers. Do not treat the PM2 parent's CPU and memory values as complete Worker metrics. Monitor business processes and containers separately.

Keep PM2's default SIGINT shutdown path. Do not set `shutdown_with_message: true`: it sends a `"shutdown"` message that this CLI does not handle. See PM2's [shutdown mechanism](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/) and [configuration fields](https://pm2.keymetrics.io/docs/usage/application-declaration/).

### Common PM2 commands

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs myapp
pm2 restart myapp

# Reload in fork mode does not guarantee zero interruption.
# Check health and connection behavior before a release.
pm2 reload myapp

pm2 stop myapp
pm2 monit
pm2 startup
pm2 save
```

:::tip VextJS Cluster and PM2 Cluster
Enable VextJS's built-in Cluster with `cluster.enabled: true` or `VEXT_CLUSTER=1`; `cluster.workers` selects the Worker count. `start` does not support `--cluster` or `--workers` flags. When using built-in Cluster, keep PM2 `instances: 1` and let VextJS manage the Workers. Rolling replacement still depends on the platform and readiness conditions below. See [Cluster](/guide/cluster).
:::

PM2's single fork example provides no multi-instance rolling guarantee. Even with Vext Cluster, keep one outer instance. SIGHUP reload must target the Vext Master PID; do not assume `pm2 reload` invokes Vext's rolling protocol. Configure shared Sessions, rate limits and connection pools separately.

## Log collection

### JSON log format

Set `pretty: false` explicitly for newline-delimited production JSON logs. CLI startup notices may share the same stream, so collectors must distinguish them. Do not add PM2 timestamp prefixes that break JSON parsing. These fields illustrate default ISO timestamps; see [Logger](/guide/logger) and [Access Log](/api/access-log) for actual request log formats:

```json
{
  "level": 30,
  "time": "2026-03-05T14:23:05.123Z",
  "requestId": "abc-123",
  "msg": "→ GET /api/users 200 45ms"
}
```

### Configure log level

```typescript
// src/config/production.ts
export default {
  logger: {
    level: "info", // Recommended info for production environment (does not output debug)
    pretty: false, // disable pretty in production environment (default behavior)
    prettyColor: "never", // Optional: Explicitly disable pretty ANSI
  },
};
```

### Log collection plan

#### Solution 1: File + Filebeat → ELK

```bash
# PM2 output log to file
pm2 start ecosystem.config.cjs

# Filebeat collects log files → Elasticsearch → Kibana
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

This uses [Filebeat filestream and ndjson](https://www.elastic.co/docs/reference/beats/filebeat/filebeat-input-filestream). Handle parser errors for mixed startup text and add the authentication, index policy and log rotation required by your deployment. The old `log` input is deprecated.

#### Option 2: Docker log → Loki

Install and configure the driver on the Docker host using the [Loki Docker driver instructions](https://grafana.com/docs/loki/latest/send-data/docker-driver/). This fragment only selects the driver; it does not install the driver or deploy Loki.

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

#### Option 3: stdout → Cloud native

In platforms such as Kubernetes / AWS ECS / Cloud Run, output directly to stdout, which is automatically collected by the platform:

```bash
# No additional configuration is required, JSON logs are output directly to stdout
npx vextjs start
```

## Health Check

### Implement health check endpoint

If the scaffold already has `/health`, replace its existing handler rather than registering it twice. Keep other routes in `src/routes/index.ts`.

```typescript
// src/routes/index.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/health",
    {
      override: { rateLimit: false },
      docs: { summary: "Process liveness" },
    },
    async (_req, res) => {
      res.json({ status: "ok", uptime: process.uptime(), pid: process.pid });
    },
  );

  // Readiness check (Kubernetes readinessProbe).
  app.get(
    "/ready",
    {
      override: { rateLimit: false },
      docs: { summary: "Ready for traffic" },
    },
    async (_req, res) => {
      // This API has no external dependencies. Check real availability here if yours does.
      res.json({ status: "ready" });
    },
  );
});
```

`index.ts` adds no filename prefix. If you move this to `health.ts`, register `"/"` there; registering `"/health"` would create `/health/health`. The default response wrapper puts status under `data.status`. Configure bypasses for global auth, middleware or caching as needed; disabling rate limits alone does not bypass them.

- **Liveness** asks whether the process responds. Do not restart every instance repeatedly for a brief database outage.
- **Readiness** asks whether critical dependencies work. Return 503 on failure and 200 after recovery. `app.db !== undefined` does not prove a live connection. An initialized `req.app.db.client` can perform a real ping with a timeout; first configure [Database](/guide/database).
- **Cluster:** one HTTP probe reaches only one Worker. `vext status` checks `/health`, but does not replace all-Worker, dependency and business checks. Exit code 0 is insufficient as a deployment health gate.

After checking the 200 path, deliberately make a critical dependency unavailable, confirm readiness returns 503 and the instance leaves traffic, then restore and verify again.

### Kubernetes probe configuration

```yaml
# Fragment inside a Deployment's spec.template
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

Put this fragment in a Deployment's `spec.template`; a complete resource also needs metadata, selector, replicas and image pull configuration. Consider `startupProbe` based on actual startup time. Replicas, readiness and a termination grace period work together to drain traffic; a readiness probe alone does not guarantee zero interruption. See [Kubernetes probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/).

## Abnormal crash notification (onFatalError)

VextJS has a built-in process-level exception catching mechanism. When an `uncaughtException` or `unhandledRejection` occurs, the framework will:

1. Record `fatal` level logs
2. Call the user-configured `onFatalError` callback (if any)
3. Perform graceful shutdown (onClose hooks clean up resources)
4. `process.exit(1)` Exit the process

### Configure onFatalError

Add the `onFatalError` callback in the `shutdown` configuration to access alarm notifications:

```typescript
// src/config/production.ts
import type { VextConfigOverride } from "vextjs";

export default {
  shutdown: {
    timeout: 10, // Seconds; separate from the fatal callback's wait.
    onFatalError: async (error, origin) => {
      // origin: 'uncaughtException' | 'unhandledRejection'

      // Example: Send DingTalk Webhook
      await fetch("https://oapi.dingtalk.com/robot/send?access_token=xxx", {
        method: "POST",
        signal: AbortSignal.timeout(3000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: {
            title: "⚠️ Service exception",
            text: [
              "## ⚠️ The service crashed abnormally",
              `- **service**: my-service`,
              `- **Source**: ${origin}`,
              `- **Error**: ${error.message}`,
              `- **Time**: ${new Date().toISOString()}`,
              `- **Stack**:\n\`\`\`\n${error.stack}\n\`\`\``,
            ].join("\n"),
          },
        }),
      });
    },
  },
} satisfies VextConfigOverride;
```

Replace the Webhook URL with your own. The target service determines notification format and access. Each following snippet replaces the same `onFatalError` callback. Give external requests a timeout and check the response; a non-2xx HTTP response is not a successful notification.

### Enterprise WeChat Webhook Example

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
          `## <font color="warning">Service crashed abnormally</font>`,
          `> Service: my-service`,
          `> Source: ${origin}`,
          `> Error: ${error.message}`,
          `> Time: ${new Date().toISOString()}`,
        ].join('\n'),
      },
    }),
  });
},
```

### Slack Webhook Example

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

### Generic HTTP Webhook Example

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

### Notes

| Project                  | Description                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Timeout Protection**   | `onFatalError` is awaited for at most 10 seconds before shutdown; this is not a total exit deadline and does not cancel network requests automatically |
| **Error Isolation**      | Exceptions thrown inside the callback will be caught and recorded, and will not prevent the process from exiting                                       |
| **Unrecoverable**        | After `uncaughtException`, the process is in an uncertain state, the callback should be as light as possible (just send a notification)                |
| **Test Mode**            | Do not register fatal error handlers under `_testMode` to avoid interfering with testing                                                               |
| **Cooperating with PM2** | PM2 itself also has restart notification capabilities (plug-ins such as `pm2-slack`), which can be used in conjunction with `onFatalError`             |

:::tip Why can’t it be implemented using middleware?
`uncaughtException` and `unhandledRejection` occur outside the HTTP middleware execution chain (such as exceptions in scheduled tasks and event listeners), and middleware cannot catch such errors. Therefore, `process` level event listeners must be registered in the framework bootstrap layer.
:::

## Security hardening

### Production environment list

| #   | Check items               | Description                                                                                                         |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **HTTPS**                 | Choose TLS termination at Nginx, CDN or another layer according to the deployment architecture                      |
| 2   | **CORS**                  | Configure `config.cors` to limit allowed source domain names                                                        |
| 3   | **Rate Limit**            | Configure `config.rateLimit` to set stricter rate limits for sensitive interfaces such as login                     |
| 4   | **Security Headers**      | Configure `config.securityHeaders` for low-impact defaults and opt-in strict/custom browser response headers        |
| 5   | **Environment variables** | Follow project policy for environment variables, config files or a secret service; verify the real injection source |
| 6   | **config/local.ts**       | Make sure `.gitignore` contains `config/local.*`                                                                    |
| 7   | **Log**                   | Do not output sensitive data (password, token, etc.) to the log                                                     |
| 8   | **Dependency Audit**      | Regular `npm audit` to fix known vulnerabilities in a timely manner                                                 |
| 9   | **Non-root**              | Running as a non-root user in a Docker container                                                                    |
| 10  | **Graceful shutdown**     | Ensure `SIGTERM` signal is handled correctly (VextJS built-in support)                                              |

### Environment variable management

VextJS does not automatically parse `.env` files and does not bundle an implicit
dotenv loader. Values read through `process.env` must be injected by the OS,
shell, process manager, container platform, CI/CD system, secret manager, or a
loader that your application explicitly owns. The scaffold still ignores
`.env*` files to reduce accidental commits when external tools create them; that
Git protection does not mean Vext loads those files.

```bash
# Shell or CI-owned injection for one process
VEXT_PORT=3000 MONGODB_URL=mongodb://localhost:27017/myapp npm start

# Container/platform-owned injection
docker run -e MONGODB_URL=mongodb://mongo:27017/myapp myapp
# Kubernetes: Secret + ConfigMap
```

## Performance optimization

### Node.js Parameters

```bash
# Set the V8 old-space limit in MiB for a measured workload.
NODE_OPTIONS=--max-old-space-size=4096 npx vextjs start

# POSIX shell example; PowerShell uses $env:NODE_OPTIONS.
```

Node's default heap limit depends on version, platform and available memory; it is not a fixed 1.5 GB. This flag limits V8 old space, not process RSS or the entire container.

### Source Map

Backend build emits `.js.map` files by default, but esbuild's `external` mode does not write `sourceMappingURL`. Setting only `NODE_OPTIONS=--enable-source-maps` therefore **does not guarantee that current stack traces map to TypeScript**. Associate JS and maps in your diagnostic platform and verify with an actual exception; see [Build Source Map boundaries](/guide/build#source-map).

### Cluster multi-process

Merge these settings into existing production config, then build and start. Validate a fixed Worker count against real CPU, memory and connection pool budgets. With `"auto"`, the framework uses detected available CPUs, capped at 64.

```typescript
// src/config/production.ts (merge with existing config)
import type { VextConfigOverride } from "vextjs";

export default {
  cluster: { enabled: true, workers: 4 },
} satisfies VextConfigOverride;
```

```bash
npx vextjs build --typecheck --outdir dist
npx vextjs start --outdir dist --port 3000
```

See [Cluster multi-process](/guide/cluster) for details.

### Connection pool optimization

```typescript
// src/config/production.ts
export default {
  // Request timeout and retry budget, not connection pool size.
  fetch: {
    timeout: 5000, // Shorten timeout for production environment
    retry: 2, // Idempotent method automatically retries
  },

  // Database connection pool.
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

Each Worker creates its own pool. Estimate the maximum connection budget as pool limit × Workers × replicas, plus monitoring and other processes. Fetch retries apply only to supported idempotent methods and replayable requests; include every attempt timeout and backoff in the total budget. See [HTTP Client](/guide/fetch).

## Deployment process suggestions

### CI/CD pipeline

```
Push to main
  → CI check (lint + typecheck + test)
  → vext build
  → Docker build (build image)
  → Push to Registry
  → Deploy (Rolling Update)
  → Health Check (verification)
```

### Gradual rollout

1. Build an image with a unique version tag, retaining the current image and matching configuration.
2. Deploy the new version on a new port or replica, then directly verify real health, readiness and business requests.
3. Check and reload proxy configuration before introducing weighted traffic. A weight is a scheduling ratio, not an exact count per ten requests.
4. Observe errors, latency, dependency load and session compatibility. Increase traffic after validation; switch back to the old instance on failure.
5. Drain the old instance, wait for in-flight requests and long connections, then stop it. Database schema changes need their own compatibility and rollback plan.

```bash
docker build -t myapp:v1.2.0 .
docker run -d --name myapp-canary -p 3001:3000 --stop-timeout 30 myapp:v1.2.0
curl -i http://127.0.0.1:3001/health
```

Supply the actual database connection config above when this app needs a database. Replace the Nginx upstream with:

```nginx
upstream vext_backend {
    server 127.0.0.1:3000 weight=9;
    server 127.0.0.1:3001 weight=1;
}
```

Vext Cluster reload does not update Master configuration, publish images, change database schemas, or preserve every long connection. `sticky: "ip"` routes TCP peer addresses to stable Worker slots inside one instance. Proxies/NAT can create hotspots, and failures or rolling replacement do not migrate in-memory sessions. External instance affinity does not provide Worker affinity behind a shared port. With zero Workers and no pending replacement, the standard host records failed state, cleans its PID, and exits 1 for supervisor recovery. Remaining healthy Workers keep running, so monitor ready capacity and business health.

## Monitor alarms

### Key monitoring indicators

This table is only a starting point for alert design. Adjust it for business SLOs, baselines and resource limits; these values are not framework metrics or performance guarantees.

| Indicators                   | Normal range | Alarm conditions    |
| ---------------------------- | ------------ | ------------------- |
| Response time P99            | < 500ms      | > 1s for 5 minutes  |
| Error rate (5xx)             | < 0.1%       | > 1% for 1 minute   |
| Memory usage                 | < 80% limit  | > 90% for 5 minutes |
| CPU usage                    | < 70%        | > 90% for 5 minutes |
| Number of active connections | < 1000       | > 5000              |
| Database connection pool     | No waiting   | Waiting time > 1s   |

### Prometheus Metrics Endpoint

Initialize a real Prometheus Exporter following the [OpenTelemetry example](/examples/opentelemetry), and configure the collector for its actual port and path. An ordinary `res.json()` response is not a Prometheus metrics endpoint.

## Shared resources across services

Each service uses its own cwd, profile, business port, generated outputs and persistent data directory. Different ports do not isolate same-domain cookies. Choose cookie names, path/domain and Session store namespaces according to whether sessions should be shared. Configure isolation explicitly when separate Sessions are needed; changing only the port is insufficient.

Response caching, MonSQLize query caching, Session and rate limiting are different systems. Check key prefixes/namespaces, TTL units and invalidation scope before sharing stores. Vext does not rename user configuration based on inferred intent. Estimate connections as each process's pool limit × workers × services, plus independent pools/proxies; actual external limits need deployment evidence.

Model registrations in multiple apps within one process have owners: equivalent definitions can share a key; conflicting definitions fail before registration; closing one app releases only its references. Registry keys and databases/pools are distinct; see [Database](/guide/database). Separate processes have separate registries but may still share external stores.

## Deploy Job schedulers and workers

Run Job schedulers and workers as processes separate from HTTP. `npx vextjs job scheduler` creates scheduled runs, while `npx vextjs job worker` claims and executes pending runs. Configure cwd, profile, persistent storage, logs and shutdown for each process. An HTTP rolling restart does not restart them. See [Jobs](/guide/jobs).

## Publish the documentation site

When maintaining this VextJS repository, `.github/workflows/docs.yml` publishes the documentation to [GitHub Pages](https://devcodex-labs.github.io/vextjs/) with base path `/vextjs/`. Automatic publishing follows a successful main push CI and checks out that exact SHA. This is separate from application deployment above. The DevCodex Labs organization homepage is maintained in a separate repository.

## Next step

- Learn about [Cluster Multi-Processing](/guide/cluster) to take full advantage of multi-core CPUs
- See [OpenTelemetry Access](/examples/opentelemetry) for full observability
- Learn [Nacos access](/examples/nacos-integration) to implement microservice registration discovery
- Explore the environment configuration override mechanism in [Configuration](/guide/configuration)
