import type { VextMiddleware } from "../../types/middleware.js";

/**
 * responseWrapper — 出口包装中间件
 *
 * 内置中间件 #5，职责：
 *   在中间件链执行前开启 VextResponse 的包装标志（_enableWrap()），
 *   使后续 handler 调用 res.json(data) 时自动包装为：
 *     { code: 0, data, requestId }
 *
 * 设计说明（P0-2 修复记录）：
 *   原实现使用 monkey-patch（覆盖 res.json）实现出口包装，
 *   存在已知 Bug：res.status(201).json(data) 链式调用中，
 *   patched json 使用 status = 200 默认值，忽略了内部 _status，
 *   导致 HTTP 状态码始终为 200。
 *
 *   现已统一为 _enableWrap() 标志模式：
 *     - responseWrapper 中间件仅设置标志位（一行代码）
 *     - 包装逻辑在 createVextResponse 的 json() 方法内部处理
 *     - json() 检查 _wrapEnabled 标志，为 true 时自动包装
 *     - rawJson() 始终绕过包装，仅供框架内部错误处理使用
 *
 * 不可覆盖：
 *   出口包装是框架核心机制，用户不能通过插件禁用或替换。
 *   所有正常响应必须经过统一包装，确保 API 响应格式一致性。
 *
 * 执行位置：
 *   在 requestId → cors → body-parser → rateLimit 之后，
 *   在 app.use() 注册的全局中间件和路由级中间件之前。
 *   这确保所有用户代码中的 res.json() 调用都会被包装。
 *
 * 响应格式对比：
 *   包装前（handler 调用）：res.json({ id: 1, name: 'Alice' })
 *   包装后（实际响应体）：  { code: 0, data: { id: 1, name: 'Alice' }, requestId: 'a1b2c3...' }
 *
 *   错误响应（绕过包装）：  res.rawJson({ code: 404, message: '...', requestId: '...' }, 404)
 *
 * 时序保证：
 *   requestIdMiddleware 在 responseWrapper 之前执行，
 *   因此 _enableWrap() 开启后，json() 内部通过 getRequestId() getter
 *   获取的 requestId 一定是已填充的有效值。
 */
export const responseWrapper: VextMiddleware = async (req, res, next) => {
  // 开启内建包装标志
  // _enableWrap 是 VextResponse 的内部方法，通过 Omit<VextResponse, '_enableWrap' | 'rawJson'>
  // 从 VextPublicResponse 类型中排除，用户不可见。
  //
  // 使用 (res as any) 访问是因为中间件签名中 res 类型为 VextResponse，
  // 但 _enableWrap 不在公共接口中（设计上就是如此），
  // 实际上 VextResponse 接口确实声明了 _enableWrap()，所以直接调用即可。
  res._enableWrap();

  await next();
};
