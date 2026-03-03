/**
 * hello-world 示例配置
 *
 * BUG-1 修复后，config-loader 会自动以框架内置 DEFAULT_CONFIG 为基底，
 * 深度合并用户配置。因此用户只需覆盖关心的字段，
 * 未声明的字段（如 requestId / rateLimit / cors 等）自动使用框架默认值。
 *
 * 框架默认值参见 src/lib/app.ts 中的 DEFAULT_CONFIG。
 */
export default {
  port: 3000,
  host: "0.0.0.0",
  logger: {
    level: "info",
  },
  response: {
    hideInternalErrors: false,
  },
  openapi: {
    enabled: true,
  },
};
