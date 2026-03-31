import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import crypto from "node:crypto";
import Router from "find-my-way";
import { createVextRequest, type ParsedUrl } from "./request.js";
import { createVextResponse } from "./response.js";
import { requestContext } from "../../lib/request-context.js";
import type { VextAdapter, VextServerHandle } from "../../types/adapter.js";
import type { VextApp } from "../../types/app.js";
import type {
  VextMiddleware,
  VextErrorMiddleware,
} from "../../types/middleware.js";
import type { VextRequest } from "../../types/request.js";
import type { VextResponse } from "../../types/response.js";

/**
 * Native Adapter 选项
 *
 * 用户通过 nativeAdapter(options) 工厂函数传入，
 * 控制 Native Adapter 的初始化行为。
 *
 * 所有选项均可选，默认值已为 vext 场景优化。
 *
 * Native Adapter 不依赖任何第三方 HTTP 框架（无 Fastify / Express / Koa / Hono），
 * 直接使用 Node.js 原生 http.createServer + find-my-way（trie 路由库）。
 * 这是 vext 的最高性能适配器选项。
 */
export interface NativeAdapterOptions {
  /**
   * 忽略尾部斜杠（默认 true）
   * /users 和 /users/ 视为相同路由
   */
  ignoreTrailingSlash?: boolean;

  /**
   * 大小写敏感（默认 false）
   * /Users 和 /users 视为相同路由
   */
  caseSensitive?: boolean;

  /**
   * 最大参数长度（默认 500）
   * 路由参数（如 :id）的最大字符数
   */
  maxParamLength?: number;
}

// ── 路由处理器存储类型 ──────────────────────────────────────────
//
// find-my-way 的 store 概念：每条路由匹配后返回 handler + params。
// 我们将预组装的完整中间件链存储在 store 中，避免每请求重新组装。
//

interface RouteStore {
  /** 预组装的完整中间件链（全局 + 路由级，首次请求时构建并缓存） */
  chain: VextMiddleware[] | null;
  /** 路由级中间件链（registerRoute 传入的 chain） */
  routeChain: VextMiddleware[];
  /** 预解析的 URL 信息（由 handleRequest 在 lookup 前设置，供 handler 传给 createVextRequest） */
  parsedUrl: ParsedUrl | null;
  /**
   * 路由模板字符串（如 `/users/:id`）
   *
   * 在 registerRoute 时写入，onRouteMatch 读取后赋值到 req.route。
   * find-my-way 的 onRouteMatch 是独立函数，无法直接访问 registerRoute closure，
   * 因此通过 store 传递（D2 架构决策）。
   */
  routePath: string;
}

/**
 * 中间件链执行器（洋葱模型）
 *
 * 按顺序执行中间件链中的每个中间件，
 * 每个中间件通过 await next() 调用下一个中间件。
 * next() 返回后可执行 after-middleware 逻辑（洋葱模型回溯）。
 *
 * 逻辑与 Fastify / Express / Koa / Hono Adapter 的 executeChain 完全一致，
 * 确保所有 Adapter 的中间件执行语义相同。
 *
 * 性能优化：
 *   - 使用参数化递归 dispatch(i) 替代每请求闭包链创建
 *   - len 提前缓存避免每次 dispatch 访问 chain.length
 *
 * @param chain 中间件执行链（已组装完毕，含全局 + 路由级 + validate + handler）
 * @param req   VextRequest 实例
 * @param res   VextResponse 实例
 */
async function executeChain(
  chain: VextMiddleware[],
  req: VextRequest,
  res: VextResponse,
): Promise<void> {
  const len = chain.length;

  // ── F2 快速路径：仅 1 个中间件时跳过递归调度 ──────────
  //
  // benchmark 中所有中间件都被禁用后，chain 只含 1 个 handlerMiddleware。
  // 标准路径每请求创建 4+ 个 Promise（executeChain / dispatch(0) / middleware / dispatch(1)）。
  // 快速路径仅创建 1 个 Promise（middleware 本身），减少 ~75% 的 Promise/微任务开销。
  //
  // 语义等价性：单元素链中 next() 应为 noop（dispatch(1) → i >= len → return）。
  // 这里用预创建的静态 noop 替代，避免每请求创建新的 next 闭包。
  //
  if (len === 1) {
    await chain[0]!(req, res, _noop);
    return;
  }

  // ── F2 快速路径：2 个中间件时展开递归 ─────────────────
  //
  // 生产环境常见：1 个全局中间件 + 1 个 handler。
  // 展开后减少 2 个 Promise（dispatch(0) + dispatch(2)），仅保留 2 个 await。
  //
  if (len === 2) {
    await chain[0]!(req, res, async () => {
      await chain[1]!(req, res, _noop);
    });
    return;
  }

  // ── 标准洋葱模型递归（3+ 中间件）─────────────────────
  async function dispatch(i: number): Promise<void> {
    if (i >= len) return;
    const middleware = chain[i]!;
    await middleware(req, res, () => dispatch(i + 1));
  }

  await dispatch(0);
}

/** 静态 noop next 函数（F2 快速路径复用，避免每请求创建新闭包） */
const _noop = async (): Promise<void> => {};

/**
 * createNativeAdapter — 创建基于 http.createServer + find-my-way 的 VextAdapter 实例
 *
 * 将 Node.js 原生 HTTP 服务器作为底层，配合 find-my-way radix trie 路由器，
 * 实现 VextAdapter 接口。这是 vext 的第五个 adapter 实现，
 * 也是唯一不依赖第三方 HTTP 框架的实现。
 *
 * 架构说明：
 *   - 路由匹配：find-my-way radix trie（与 Fastify 内部使用的同一库）
 *   - HTTP 层：Node.js 原生 http.createServer，零框架开销
 *   - 中间件链执行：vext 自己的 executeChain（洋葱模型）
 *   - 请求/响应对象：直接从 IncomingMessage / ServerResponse 构造 VextRequest / VextResponse
 *   - 全局中间件：通过 registerMiddleware() 收集，在每个路由执行时拼接到链头
 *
 * 与其他 Adapter 的核心差异：
 *   - 无第三方框架依赖（Fastify / Express / Koa / Hono 均被跳过）
 *   - 请求对象直接从 IncomingMessage 构造，无中间包装层
 *   - 响应对象直接操作 ServerResponse，无框架 reply / ctx 层
 *   - Body 读取：直接从 IncomingMessage 数据流读取 Buffer → string
 *   - JSON 序列化：直接 serverResponse.end(JSON.stringify(...))
 *   - 路由匹配：find-my-way 的 lookup 方法直接在 http handler 中调用
 *
 * 性能预期：
 *   相比 Fastify Adapter，Native Adapter 省去了：
 *   1. Fastify 框架初始化开销（plugin 系统、hook 系统）
 *   2. Fastify 的 request/reply 对象构造
 *   3. Fastify 的 content-type parser 管道
 *   4. Fastify 的 serialization 管道
 *   5. Fastify 的 lifecycle hooks 调用
 *   预估 RPS 提升 +44-73%（相对 vext-Fastify）
 *
 * HTTP 服务器：
 *   - listen() 创建 http.createServer 并开始监听
 *   - close() 关闭服务器
 *   - buildHandler() 返回 (req, res) => void 处理函数，
 *     用于 dev 模式热重载的 HotSwappableHandler 原子替换
 *
 * @param options Native 适配器配置选项
 * @param app     VextApp 实例（用于传递给 createVextRequest 的 app 引用）
 * @returns VextAdapter 实例
 *
 * @see adapters/fastify/adapter.ts（Fastify Adapter 对应实现）
 * @see adapters/express/adapter.ts（Express Adapter 对应实现）
 * @see adapters/koa/adapter.ts（Koa Adapter 对应实现）
 * @see adapters/hono/adapter.ts（Hono Adapter 对应实现）
 */
export function createNativeAdapter(
  options: NativeAdapterOptions,
  app: VextApp,
): VextAdapter {
  // ── 创建 find-my-way 路由器 ────────────────────────────────
  //
  // find-my-way 是 Fastify 内部使用的 radix trie 路由库，
  // 路由匹配性能极高（O(path_length)），支持参数路由和通配符。
  //
  // 关键配置：
  //   - ignoreTrailingSlash: true — /users 和 /users/ 等价
  //   - caseSensitive: false — /Users 和 /users 等价
  //   - maxParamLength: 500 — 路由参数最大长度
  //   - defaultRoute: 由 registerNotFound 设置
  //
  const router = Router({
    ignoreTrailingSlash: options.ignoreTrailingSlash ?? true,
    caseSensitive: options.caseSensitive ?? false,
    maxParamLength: options.maxParamLength ?? 500,
    defaultRoute: (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
      // P3 优化：lookup() 未匹配时走 defaultRoute（替代 find() === null 判断）
      handleNotFound(nodeReq, nodeRes);
    },
  });

  // ── 🆕 5.7: 缓存 ALS 开关（避免热路径重复读取 config）────
  const alsEnabled = app.config.requestContext?.enabled !== false;

  // ── 全局状态 ──────────────────────────────────────────────

  /** 全局中间件列表（通过 registerMiddleware 收集，在每个路由执行时拼接到链头） */
  const globalMiddlewares: VextMiddleware[] = [];

  /** 错误处理函数（通过 registerErrorHandler 注册） */
  let errorHandler: VextErrorMiddleware | null = null;

  /** 404 兜底处理函数（通过 registerNotFound 注册） */
  let notFoundHandler: VextMiddleware | null = null;

  /**
   * 处理请求的核心函数
   *
   * 由 listen() 和 buildHandler() 共用。
   * 接收原始 Node.js IncomingMessage / ServerResponse，
   * 执行路由匹配 → 中间件链 → 错误处理 → 404 兜底的完整流程。
   *
   * 设计说明：
   *   - 使用 find-my-way 的 find() 方法手动查找路由（而非 lookup()），
   *     因为 find() 返回路由信息和参数，允许我们自行控制后续流程。
   *   - 如果路由未匹配，执行 notFoundHandler。
   *   - 如果中间件链执行抛出异常，执行 errorHandler。
   *   - 如果 errorHandler 自身也抛出异常，发送最低限度的 500 JSON 响应。
   */
  /**
   * 处理匹配到路由的请求
   *
   * P3 优化：作为 find-my-way lookup() 的 handler 回调直接调用，
   * 避免 find() 返回中间对象 { handler, params, store } 的每请求分配。
   *
   * @param nodeReq   原始 IncomingMessage（由 lookup 传入）
   * @param nodeRes   原始 ServerResponse（由 lookup 传入）
   * @param params    路由参数（由 lookup 解析后传入）
   * @param store     路由关联的 store 数据（含预组装的中间件链）
   */
  function onRouteMatch(
    nodeReq: IncomingMessage,
    nodeRes: ServerResponse,
    params: Record<string, string | undefined>,
    store: RouteStore,
  ): void {
    const routeParams = (params ?? {}) as Record<string, string>;

    // ── 使用 store 中缓存的预解析 URL 信息 ──────────────
    // P2 优化：handleRequest 在 lookup 前已解析并存入 store.parsedUrl
    const parsedUrl = store.parsedUrl!;
    // 立即清除引用，防止跨请求泄漏
    store.parsedUrl = null;

    // ── 构造 VextRequest / VextResponse ──────────────────
    // P2 优化：传递预解析的 URL 信息，createVextRequest 不再重复 indexOf('?')
    const req = createVextRequest(nodeReq, app, routeParams, parsedUrl);
    // F-01：注入路由模板（如 /users/:id），解决 Prometheus 高基数问题
    req.route = store.routePath;
    const res = createVextResponse(nodeRes, () => req.requestId);

    // ── 预组装中间件链（首次请求时构建，后续复用）──────────
    //
    // 与 Fastify / Express / Koa Adapter 的 prebuiltChain 逻辑一致：
    // 注册路由时 globalMiddlewares 尚未完成收集（bootstrap 步骤⑥在步骤⑤之后），
    // 因此在首次请求时组装并缓存，后续请求直接复用。
    //
    if (store.chain === null) {
      store.chain = globalMiddlewares.concat(store.routeChain);
    }

    // ── 在 AsyncLocalStorage 请求上下文中执行整个中间件链 ──
    //
    // 确保 app.throw 等内部方法能通过 requestContext.getStore() 访问请求级数据。
    //
    // 🆕 5.7: 当 requestContext.enabled === false 时跳过 ALS 包裹，
    // 直接执行中间件链，预估 +3-8% RPS。
    //
    const runChain = async () => {
      try {
        await executeChain(store.chain!, req, res);
      } catch (err) {
        if (errorHandler) {
          // errorHandler 自身抛异常的边界保护
          try {
            errorHandler(err, req, res);
          } catch (_handlerError) {
            sendFallbackError(nodeRes);
          }
        } else {
          sendFallbackError(nodeRes);
        }
      }
    };

    if (alsEnabled) {
      requestContext.run({ requestId: "", locale: undefined }, runChain);
    } else {
      runChain();
    }
  }

  /**
   * 处理请求的核心入口函数
   *
   * 由 listen() 和 buildHandler() 共用。
   * 接收原始 Node.js IncomingMessage / ServerResponse。
   *
   * P2 优化：预解析 URL（indexOf('?') 仅执行一次），结果通过 _pendingParsedUrl 传递。
   * P3 优化：使用 router.lookup() 替代 router.find()，
   *   lookup() 直接调用注册的 handler（onRouteMatch），不分配中间对象。
   */
  function handleRequest(
    nodeReq: IncomingMessage,
    nodeRes: ServerResponse,
  ): void {
    // ── P2 优化：预解析 URL（一次性 indexOf('?')）──────────
    const url = nodeReq.url ?? "/";
    const qIdx = url.indexOf("?");
    const pathname = qIdx === -1 ? url : url.slice(0, qIdx);
    const queryString = qIdx === -1 ? "" : url.slice(qIdx + 1);

    // 将预解析结果存入模块级临时变量，供 onRouteMatch 中取出
    _pendingParsedUrl = { rawUrl: url, path: pathname, queryString };

    // P3 优化：使用 lookup() 替代 find()
    // lookup() 直接调用注册的 handler（不分配中间对象），未匹配时走 defaultRoute
    router.lookup(nodeReq, nodeRes);
  }

  /** 模块级临时变量：在 handleRequest → lookup → onRouteMatch 之间传递预解析 URL */
  let _pendingParsedUrl: ParsedUrl | null = null;

  /**
   * 处理 404 未匹配请求
   *
   * 当没有任何路由匹配时执行 notFoundHandler。
   * notFound 不经过中间件链，requestId 中间件不会执行。
   * 需要内联生成 requestId，确保 404 响应也有有效的 requestId。
   */
  function handleNotFound(
    nodeReq: IncomingMessage,
    nodeRes: ServerResponse,
  ): void {
    if (!notFoundHandler) {
      // 无 notFound handler（理论上 bootstrap 一定会注册），发送默认 404
      nodeRes.statusCode = 404;
      nodeRes.setHeader("Content-Type", "application/json; charset=utf-8");
      const body = JSON.stringify({ code: 404, message: "Not Found" });
      nodeRes.setHeader("Content-Length", Buffer.byteLength(body));
      nodeRes.end(body);
      return;
    }

    // P2 优化：使用 handleRequest 中已预解析的 URL 信息
    const parsedUrl = _pendingParsedUrl ?? {
      rawUrl: nodeReq.url ?? "/",
      path: nodeReq.url ?? "/",
      queryString: "",
    };
    _pendingParsedUrl = null;

    const req = createVextRequest(nodeReq, app, {}, parsedUrl);
    const res = createVextResponse(nodeRes, () => req.requestId);

    // 内联生成 requestId（notFound 不走中间件链）
    if (!req.requestId) {
      const headerName = app.config.requestId?.header ?? "x-request-id";
      req.requestId =
        (req.headers[headerName] as string) || crypto.randomUUID();
    }

    // 🆕 5.7: ALS 可配置跳过
    const runNotFound = async () => {
      const noop = async (): Promise<void> => {};
      try {
        await notFoundHandler!(req, res, noop);
      } catch {
        sendFallbackError(nodeRes);
      }
    };

    if (alsEnabled) {
      requestContext.run(
        { requestId: req.requestId, locale: undefined },
        runNotFound,
      );
    } else {
      runNotFound();
    }
  }

  /**
   * 发送最低限度的 500 错误响应
   *
   * 当 errorHandler 自身也抛出异常时，发送最后兜底的 JSON 错误响应。
   * 直接操作 ServerResponse，不经过任何 vext 抽象。
   */
  function sendFallbackError(nodeRes: ServerResponse): void {
    if (!nodeRes.headersSent) {
      try {
        nodeRes.statusCode = 500;
        nodeRes.setHeader("Content-Type", "application/json; charset=utf-8");
        const body = JSON.stringify({
          code: 500,
          message: "Internal Server Error",
        });
        nodeRes.setHeader("Content-Length", Buffer.byteLength(body));
        nodeRes.end(body);
      } catch {
        // 完全放弃（连接可能已断开）
      }
    }
  }

  return {
    name: "native",

    // ── registerMiddleware ───────────────────────────────────
    //
    // 收集全局中间件。bootstrap 步骤⑥中注册的内置中间件
    // （requestId / cors / body-parser / rate-limit / response-wrapper / access-log）
    // 和插件通过 app.use() 注册的中间件都通过此方法收集。
    //
    // 执行时机：在每个路由的 handler 中，全局中间件拼接在路由级中间件之前执行。
    //
    registerMiddleware(middleware: VextMiddleware): void {
      globalMiddlewares.push(middleware);
    },

    // ── registerRoute ───────────────────────────────────────
    //
    // 为每条路由注册到 find-my-way 路由器。
    //
    // 流程：
    //   1. 将 vext 路径格式转为 find-my-way 格式（两者都使用 :param 格式，基本兼容）
    //   2. 将路由级中间件链存储在 find-my-way 的 store 中
    //   3. 预组装中间件链在首次请求时完成（延迟到 globalMiddlewares 收集完毕后）
    //
    // find-my-way 的 store 概念：
    //   通过 router.on(method, path, { store: ... }) 将自定义数据关联到路由。
    //   router.find() 匹配后返回 store，避免闭包捕获开销。
    //
    registerRoute(method: string, path: string, chain: VextMiddleware[]): void {
      // find-my-way 使用大写方法名（GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS）
      const fmwMethod = method.toUpperCase() as Router.HTTPMethod;

      // vext 路由参数格式（:param）与 find-my-way 格式一致，无需转换
      // 通配符 *path 在 find-my-way 中也支持，无需转换
      const fmwPath = path;

      // 创建 store 对象，存储路由级中间件链
      // chain 在首次请求时与 globalMiddlewares 合并并缓存
      const store: RouteStore = {
        chain: null, // 延迟组装
        routeChain: chain,
        parsedUrl: null, // handleRequest 在 lookup 前设置
        routePath: fmwPath, // F-01：路由模板，供 onRouteMatch 赋值到 req.route
      };

      // P3 优化：注册 onRouteMatch 为 handler，lookup() 直接调用它
      // 避免 find() 返回中间对象 { handler, params, store } 的每请求分配
      router.on(
        fmwMethod,
        fmwPath,
        (
          nodeReq: IncomingMessage,
          nodeRes: ServerResponse,
          params: Record<string, string | undefined>,
          routeStore: RouteStore,
        ) => {
          // 从模块级临时变量取出预解析 URL 并存入 store
          routeStore.parsedUrl = _pendingParsedUrl;
          _pendingParsedUrl = null;
          onRouteMatch(nodeReq, nodeRes, params, routeStore);
        },
        store,
      );
    },

    // ── registerErrorHandler ────────────────────────────────
    //
    // 注册全局错误处理函数。
    //
    // 中间件链执行过程中抛出的所有错误都由此函数处理。
    // 与 Fastify Adapter 不同，Native Adapter 没有框架层面的错误处理，
    // 完全由 handleRequest 内的 try-catch 捕获并转发到 errorHandler。
    //
    registerErrorHandler(handler: VextErrorMiddleware): void {
      errorHandler = handler;
    },

    // ── registerNotFound ────────────────────────────────────
    //
    // 注册 404 兜底处理函数。
    //
    // 当 find-my-way 的 find() 返回 null（无匹配路由）时，
    // 由 handleRequest 调用此处理函数。
    //
    registerNotFound(handler: VextMiddleware): void {
      notFoundHandler = handler;
    },

    // ── listen ──────────────────────────────────────────────
    //
    // 启动 HTTP 服务器。
    //
    // 流程：
    //   1. 创建 Node.js http.createServer（传入 handleRequest 作为 requestListener）
    //   2. 调用 server.listen() 开始监听端口
    //   3. 返回 VextServerHandle（含 close / port / host）
    //
    // 与 Fastify Adapter 的差异：
    //   - Fastify: 调用 fastify.listen() → 内部创建 http.createServer
    //   - Native: 直接调用 http.createServer()，无框架中间层
    //
    async listen(
      port: number,
      host: string = "0.0.0.0",
    ): Promise<VextServerHandle> {
      const server: Server = createServer(handleRequest);

      return new Promise<VextServerHandle>((resolve, reject) => {
        server.on("error", (err) => {
          reject(err);
        });

        server.listen(port, host, () => {
          const addr = server.address();
          const actualPort =
            typeof addr === "object" && addr !== null ? addr.port : port;
          const actualHost =
            typeof addr === "object" && addr !== null
              ? (addr.address ?? host)
              : host;

          resolve({
            port: actualPort,
            host: actualHost,

            close(): Promise<void> {
              return new Promise<void>((resolveClose, rejectClose) => {
                server.close((err) => {
                  if (err) {
                    rejectClose(err);
                  } else {
                    resolveClose();
                  }
                });
              });
            },
          });
        });
      });
    },

    // ── buildHandler ────────────────────────────────────────
    //
    // 构建完整的请求处理函数（不启动 server）。
    //
    // 返回的 handler 接受原始 Node.js req/res，内部完成：
    //   - 路由匹配（find-my-way find()）
    //   - 请求/响应对象转换（IncomingMessage → VextRequest / ServerResponse → VextResponse）
    //   - 中间件链执行（executeChain）
    //   - 错误处理 + 404 兜底
    //
    // 用途：dev 模式下 Hot Reload 每次创建 fresh adapter 后调用
    // buildHandler() 获取新 handler，由 HotSwappableHandler 原子替换。
    //
    // 与 Fastify Adapter 的差异：
    //   - Fastify: 返回 fastify.routing（需要先 fastify.ready()）
    //   - Native: 直接返回 handleRequest 函数，无需 ready 阶段
    //
    buildHandler(): (req: IncomingMessage, res: ServerResponse) => void {
      return handleRequest;
    },
  };
}
