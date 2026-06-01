/**
 * egg.js 基准测试路由定义
 *
 * 场景：
 *   1. GET /json         → 纯 JSON 响应
 *   2. GET /users/:id    → 路由参数解析
 *   3. GET /chain        → 3 层 handler 内联业务链 + JSON 响应
 *   4. GET /health       → 健康检查（benchmark 脚本用于判断服务器就绪）
 */

module.exports = (app) => {
  const { router, controller } = app;

  // 场景 1: 纯 JSON 响应
  router.get("/json", controller.benchmark.json);

  // 场景 2: 路由参数解析
  router.get("/users/:id", controller.benchmark.users);

  // 场景 3: 3 层 handler 内联业务链 + JSON 响应
  // 中间件已通过 config.middleware + match 配置注册，仅对 /chain 生效
  router.get("/chain", controller.benchmark.chain);

  // 健康检查
  router.get("/health", controller.benchmark.health);
};
