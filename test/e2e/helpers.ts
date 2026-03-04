/**
 * E2E 测试辅助函数
 *
 * 提供真实 HTTP 服务器端到端测试所需的基础设施：
 *   - 临时项目创建（完整 vext 项目结构）
 *   - 端口分配（避免并行测试冲突）
 *   - HTTP 请求工具（真实 TCP 连接）
 *   - bootstrap 生命周期管理（启动 + 优雅关闭）
 *
 * @module test/e2e/helpers
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import type { BootstrapResult } from "../../src/lib/bootstrap.js";

// ── 端口分配 ────────────────────────────────────────────────

/**
 * 全局端口计数器
 *
 * E2E 测试使用 19000+ 端口段，避免与单元测试 / 集成测试冲突。
 * 每次调用 allocatePort() 递增，确保并行测试不冲突。
 */
let portCounter = 19000;

/**
 * 分配一个唯一端口号
 *
 * 注意：port=0 让系统分配随机端口更稳健，但 E2E 测试需要
 * 预先知道端口号以构建 HTTP 请求 URL，因此使用递增分配。
 */
export function allocatePort(): number {
  return portCounter++;
}

// ── 临时项目创建 ────────────────────────────────────────────

/**
 * E2E 项目配置
 */
export interface E2EProjectOptions {
  /** 使用的 adapter 名称 */
  adapter: "hono" | "fastify" | "express" | "koa" | "native";
  /** 监听端口 */
  port: number;
  /** 额外的 config 字段（会合并到 default config） */
  extraConfig?: Record<string, unknown>;
  /** 是否创建 service 文件（默认 false，使用 inline 逻辑） */
  withServices?: boolean;
  /** 是否创建 middleware 文件（默认 false） */
  withMiddlewares?: boolean;
}

/**
 * E2E 项目结构
 */
export interface E2EProject {
  /** 临时项目根目录 */
  rootDir: string;
  /** 端口号 */
  port: number;
  /** adapter 名称 */
  adapter: string;
}

/**
 * 创建临时 E2E 测试项目
 *
 * 生成完整的 vext 项目结构：
 *   src/
 *   ├── config/
 *   │   └── default.mjs
 *   ├── routes/
 *   │   ├── index.mjs        (GET / → hello world)
 *   │   ├── users.mjs        (CRUD: GET /list, POST /, PUT /:id, DELETE /:id)
 *   │   └── errors.mjs       (GET /sync-error, GET /async-error)
 *   └── services/
 *
 * @param options 项目配置
 * @returns 项目信息
 */
export async function createE2EProject(
  options: E2EProjectOptions,
): Promise<E2EProject> {
  const rootDir = await mkdtemp(join(tmpdir(), `vext-e2e-${options.adapter}-`));

  const srcDir = join(rootDir, "src");
  await mkdir(join(srcDir, "config"), { recursive: true });
  await mkdir(join(srcDir, "routes"), { recursive: true });
  await mkdir(join(srcDir, "services"), { recursive: true });

  // ── config/default.mjs ──────────────────────────────────
  const configContent = generateConfigContent(options);
  await writeFile(
    join(srcDir, "config", "default.mjs"),
    configContent,
    "utf-8",
  );

  // ── routes/index.mjs ───────────────────────────────────
  await writeFile(
    join(srcDir, "routes", "index.mjs"),
    generateIndexRouteContent(),
    "utf-8",
  );

  // ── routes/users.mjs ───────────────────────────────────
  await writeFile(
    join(srcDir, "routes", "users.mjs"),
    generateUsersRouteContent(),
    "utf-8",
  );

  // ── routes/health.mjs ──────────────────────────────────
  await writeFile(
    join(srcDir, "routes", "health.mjs"),
    generateHealthRouteContent(),
    "utf-8",
  );

  // ── routes/errors.mjs ──────────────────────────────────
  await writeFile(
    join(srcDir, "routes", "errors.mjs"),
    generateErrorsRouteContent(),
    "utf-8",
  );

  return {
    rootDir,
    port: options.port,
    adapter: options.adapter,
  };
}

/**
 * 清理临时项目
 */
export async function cleanupE2EProject(project: E2EProject): Promise<void> {
  if (existsSync(project.rootDir)) {
    await rm(project.rootDir, { recursive: true, force: true });
  }
}

// ── 内容生成器 ──────────────────────────────────────────────

function generateConfigContent(options: E2EProjectOptions): string {
  const extra = options.extraConfig
    ? `,\n  ...${JSON.stringify(options.extraConfig)}`
    : "";

  return `
export default {
  port: ${options.port},
  host: '127.0.0.1',
  adapter: '${options.adapter}',
  trustProxy: false,
  middlewares: [],
  cors: {
    enabled: true,
    origins: ['*'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: false,
  },
  rateLimit: {
    enabled: false,
    max: 100,
    window: 60,
    message: 'Too Many Requests',
    keyBy: 'ip',
  },
  requestId: {
    enabled: true,
    header: 'x-request-id',
    responseHeader: 'x-request-id',
  },
  logger: {
    level: 'silent',
  },
  shutdown: {
    timeout: 2,
  },
  response: {
    hideInternalErrors: true,
  },
  bodyParser: {
    maxBodySize: '1mb',
  },
  openapi: {
    enabled: false,
  },
  healthCheck: {
    enabled: true,
    path: '/health',
  },
  accessLog: {
    enabled: false,
  }${extra},
};
`;
}

/**
 * 生成 RouteDefinition 格式的辅助代码（collector + normalizePath + register）
 *
 * 临时项目的 .mjs 路由文件无法 import vextjs，
 * 所以需要内联完整的 RouteDefinition 结构。
 * 此函数生成公共的 collector 创建代码 + normalizePath + register 方法。
 */
function routeDefinitionBoilerplate(): string {
  return `
function createCollector(routes) {
  function makeMethod(method) {
    return (path, optionsOrHandler, handler) => {
      if (typeof optionsOrHandler === 'function') {
        routes.push({ method, path, options: {}, handler: optionsOrHandler });
      } else {
        routes.push({ method, path, options: optionsOrHandler || {}, handler });
      }
    };
  }
  return {
    get: makeMethod('GET'),
    post: makeMethod('POST'),
    put: makeMethod('PUT'),
    patch: makeMethod('PATCH'),
    delete: makeMethod('DELETE'),
    head: makeMethod('HEAD'),
    options: makeMethod('OPTIONS'),
  };
}

function normalizePath(prefix, subPath) {
  const cleanPrefix = prefix.endsWith('/') && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
  const cleanSubPath = subPath.startsWith('/') ? subPath.slice(1) : subPath;
  if (!cleanSubPath) return cleanPrefix || '/';
  if (cleanPrefix === '/') return '/' + cleanSubPath;
  const fullPath = cleanPrefix + '/' + cleanSubPath;
  if (fullPath.length > 1 && fullPath.endsWith('/')) return fullPath.slice(0, -1);
  return fullPath;
}

function makeRouteDefinition(routes, collector, factory) {
  return {
    routes,
    sourceFile: '',
    register(adapter, prefix, middlewareDefs, globalMiddlewares) {
      for (const route of routes) {
        const fullPath = normalizePath(prefix, route.path);
        const handlerMiddleware = async (req, res, _next) => { await route.handler(req, res); };
        const chain = [handlerMiddleware];
        adapter.registerRoute(route.method, fullPath, chain);
      }
    },
    _factory: factory,
    _collector: collector,
  };
}
`;
}

function generateIndexRouteContent(): string {
  return `
${routeDefinitionBoilerplate()}

const routes = [];
const collector = createCollector(routes);

function factory(app) {
  collector.get('/', {}, async (req, res) => {
    res.json({ message: 'hello vext', adapter: req.app.config.adapter });
  });

  collector.get('/echo-header', {}, async (req, res) => {
    const custom = req.headers['x-custom-header'] || '';
    res.json({ echo: custom, requestId: req.requestId });
  });
}

export default makeRouteDefinition(routes, collector, factory);
`;
}

function generateHealthRouteContent(): string {
  return `
${routeDefinitionBoilerplate()}

const routes = [];
const collector = createCollector(routes);

function factory(app) {
  collector.get('/', {}, async (req, res) => {
    res.json({ status: 'ok' });
  });
}

export default makeRouteDefinition(routes, collector, factory);
`;
}

function generateUsersRouteContent(): string {
  return `
${routeDefinitionBoilerplate()}

// 简单的内存 CRUD（不依赖 service 层，E2E 测试聚焦 HTTP 链路）
const users = [
  { id: 1, name: 'Alice', email: 'alice@test.com' },
  { id: 2, name: 'Bob', email: 'bob@test.com' },
];
let nextId = 3;

const routes = [];
const collector = createCollector(routes);

function factory(app) {
  collector.get('/list', {}, async (req, res) => {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);

    if (isNaN(page) || page < 1) {
      return res.rawJson({ code: 422, message: 'Invalid page', field: 'page', requestId: req.requestId }, 422);
    }
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return res.rawJson({ code: 422, message: 'Invalid limit', field: 'limit', requestId: req.requestId }, 422);
    }

    const start = (page - 1) * limit;
    const list = users.slice(start, start + limit);

    res.json({ list, total: users.length, page, limit });
  });

  collector.post('/', {}, async (req, res) => {
    const body = req.body;
    if (!body || !body.name || !body.email) {
      return res.rawJson({ code: 422, message: 'name and email are required', requestId: req.requestId }, 422);
    }

    const user = { id: nextId++, name: body.name, email: body.email };
    users.push(user);
    res.json(user, 201);
  });

  collector.get('/:id', {}, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const user = users.find(u => u.id === id);
    if (!user) {
      return res.rawJson({ code: 404, message: 'User not found', requestId: req.requestId }, 404);
    }
    res.json(user);
  });

  collector.put('/:id', {}, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const user = users.find(u => u.id === id);
    if (!user) {
      return res.rawJson({ code: 404, message: 'User not found', requestId: req.requestId }, 404);
    }
    const body = req.body;
    if (body.name) user.name = body.name;
    if (body.email) user.email = body.email;
    res.json(user);
  });

  collector.delete('/:id', {}, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) {
      return res.rawJson({ code: 404, message: 'User not found', requestId: req.requestId }, 404);
    }
    users.splice(idx, 1);
    res.status(204).json(null);
  });
}

export default makeRouteDefinition(routes, collector, factory);
`;
}

function generateErrorsRouteContent(): string {
  return `
${routeDefinitionBoilerplate()}

const routes = [];
const collector = createCollector(routes);

function factory(app) {
  collector.get('/sync-error', {}, (_req, _res) => {
    throw new Error('Intentional sync error');
  });

  collector.get('/async-error', {}, async (_req, _res) => {
    throw new Error('Intentional async error');
  });

  collector.get('/custom-status', {}, async (_req, res) => {
    res.status(418).rawJson({ code: 418, message: "I'm a teapot" });
  });
}

export default makeRouteDefinition(routes, collector, factory);
`;
}

// ── Bootstrap 生命周期管理 ───────────────────────────────────

/**
 * E2E 应用实例（已启动的真实 HTTP 服务器）
 */
export interface E2EApp {
  /** bootstrap 返回的结果 */
  result: BootstrapResult;
  /** 项目信息 */
  project: E2EProject;
  /** 实际监听的端口（可能与配置不同，如 port=0） */
  port: number;
  /** 实际监听的 host */
  host: string;
  /** 基础 URL（如 http://127.0.0.1:19001） */
  baseUrl: string;
}

/**
 * 启动 E2E 应用
 *
 * 调用真实的 bootstrap() 函数启动完整 HTTP 服务器。
 * 返回的 E2EApp 包含 baseUrl 用于发送真实 HTTP 请求。
 *
 * @param project 已创建的 E2E 项目
 * @returns 已启动的 E2E 应用
 */
export async function startE2EApp(project: E2EProject): Promise<E2EApp> {
  // 动态导入 bootstrap（避免模块顶层副作用）
  const { bootstrap } = await import("../../src/lib/bootstrap.js");

  const result = await bootstrap(project.rootDir);

  const port = result.serverHandle.port;
  const host = result.serverHandle.host;
  const baseUrl = `http://${host}:${port}`;

  return { result, project, port, host, baseUrl };
}

/**
 * 关闭 E2E 应用
 *
 * 优雅关闭 HTTP 服务器并执行所有清理钩子。
 *
 * @param app 已启动的 E2E 应用
 */
export async function stopE2EApp(app: E2EApp): Promise<void> {
  try {
    // 先关闭 HTTP server（停止接受新连接）
    await app.result.serverHandle.close();
  } catch {
    // 静默忽略
  }

  try {
    // 执行 onClose hooks（清理资源），skipExit 避免 process.exit
    await app.result.internals.shutdown(undefined, { skipExit: true });
  } catch {
    // 静默忽略
  }
}

// ── HTTP 请求工具 ────────────────────────────────────────────

/**
 * E2E HTTP 响应
 */
export interface E2EResponse {
  /** HTTP 状态码 */
  status: number;
  /** 响应头 */
  headers: Record<string, string>;
  /** 解析后的 JSON body（如果 Content-Type 是 JSON） */
  body: unknown;
  /** 原始文本 body */
  text: string;
}

/**
 * 发送真实 HTTP 请求
 *
 * 使用 Node.js 内置 fetch（node 18+ 支持）发送请求到 E2E 应用。
 *
 * @param url 完整 URL（如 http://127.0.0.1:19001/users/list?page=1）
 * @param options fetch 选项
 * @returns 解析后的响应
 */
export async function e2eRequest(
  url: string,
  options: RequestInit = {},
): Promise<E2EResponse> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  const text = await res.text();
  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    status: res.status,
    headers,
    body,
    text,
  };
}

/**
 * 发送 GET 请求
 */
export function e2eGet(
  baseUrl: string,
  path: string,
  options?: RequestInit,
): Promise<E2EResponse> {
  return e2eRequest(`${baseUrl}${path}`, { method: "GET", ...options });
}

/**
 * 发送 POST 请求
 */
export function e2ePost(
  baseUrl: string,
  path: string,
  body?: unknown,
  options?: RequestInit,
): Promise<E2EResponse> {
  return e2eRequest(`${baseUrl}${path}`, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
}

/**
 * 发送 PUT 请求
 */
export function e2ePut(
  baseUrl: string,
  path: string,
  body?: unknown,
  options?: RequestInit,
): Promise<E2EResponse> {
  return e2eRequest(`${baseUrl}${path}`, {
    method: "PUT",
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
}

/**
 * 发送 DELETE 请求
 */
export function e2eDelete(
  baseUrl: string,
  path: string,
  options?: RequestInit,
): Promise<E2EResponse> {
  return e2eRequest(`${baseUrl}${path}`, { method: "DELETE", ...options });
}

// ── 等待与重试工具 ──────────────────────────────────────────

/**
 * 等待服务器就绪
 *
 * 轮询 health 端点直到返回 200 或超时。
 *
 * @param baseUrl 基础 URL
 * @param timeoutMs 最大等待时间（默认 5000ms）
 * @param intervalMs 轮询间隔（默认 100ms）
 */
export async function waitForReady(
  baseUrl: string,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch {
      // 服务器尚未就绪，继续等待
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Server at ${baseUrl} did not become ready within ${timeoutMs}ms`,
  );
}

/**
 * 批量创建并启动 E2E 应用（多 adapter 并行启动）
 *
 * 为每个 adapter 创建独立项目并启动，返回所有 app 实例。
 * 常用于多 adapter 对比测试。
 *
 * @param adapters 要启动的 adapter 列表
 * @returns adapter 名称到 E2EApp 的映射
 */
export async function startMultiAdapterApps(
  adapters: Array<"hono" | "fastify" | "express" | "koa" | "native">,
): Promise<Map<string, E2EApp>> {
  const apps = new Map<string, E2EApp>();

  // 顺序启动（避免端口分配竞争和 module cache 问题）
  for (const adapter of adapters) {
    const port = allocatePort();
    const project = await createE2EProject({ adapter, port });
    const app = await startE2EApp(project);
    apps.set(adapter, app);
  }

  return apps;
}

/**
 * 批量关闭并清理 E2E 应用
 *
 * @param apps startMultiAdapterApps 返回的映射
 */
export async function stopMultiAdapterApps(
  apps: Map<string, E2EApp>,
): Promise<void> {
  for (const [, app] of apps) {
    await stopE2EApp(app);
    await cleanupE2EProject(app.project);
  }
}
