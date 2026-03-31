/**
 * egg.js 基准测试配置
 *
 * 目标：最小化框架自身开销，聚焦核心路由+中间件性能测量。
 *
 * 关键配置：
 *   - 端口通过 PORT 环境变量指定（默认 7001）
 *   - 禁用安全中间件（CSRF / CORS 等），与裸跑 Koa 对齐
 *   - 日志级别设为 NONE，避免 I/O 干扰
 *   - 禁用不必要的内置中间件
 *   - chain 场景的 3 层中间件通过 config.middleware 注册
 */

const port = parseInt(process.env.PORT || "7001", 10);

module.exports = (appInfo) => {
  const config = {};

  // ── 密钥（egg 强制要求）────────────────────────────────
  config.keys = `${appInfo.name}_benchmark_secret_key_2026`;

  // ── 服务器配置 ─────────────────────────────────────────
  config.cluster = {
    listen: {
      port,
      hostname: "127.0.0.1",
    },
  };

  // ── 日志配置 ───────────────────────────────────────────
  // 完全静默日志，避免 I/O 影响性能
  config.logger = {
    level: "NONE",
    consoleLevel: "NONE",
    disableConsoleAfterReady: true,
  };

  // ── 安全配置 ───────────────────────────────────────────
  // 禁用 CSRF 等安全中间件，与其他裸跑服务器保持一致
  config.security = {
    csrf: {
      enable: false,
    },
    domainWhiteList: ["*"],
  };

  // ── 禁用不必要的内置中间件 ─────────────────────────────
  // egg 默认加载的中间件：bodyParser / notfound / siteFile / ...
  // 基准测试全部为 GET 请求，bodyParser 开销可忽略
  // 但为公平对比（vext benchmark 也禁用了 bodyParser），这里也禁用
  config.bodyParser = {
    enable: false,
  };

  // 禁用 i18n（性能开销）
  config.i18n = {
    enable: false,
  };

  // 禁用 static 文件服务
  config.static = {
    enable: false,
  };

  // 禁用 siteFile（favicon 等静态文件响应）
  config.siteFile = {
    enable: false,
  };

  // ── 注册 chain 场景中间件 ──────────────────────────────
  // 仅对 /chain 路径生效的 3 层中间件
  config.middleware = ["timing", "requestId", "auth"];

  // 中间件配置：限定路径匹配
  config.timing = {
    match: "/chain",
  };

  config.requestId = {
    match: "/chain",
  };

  config.auth = {
    match: "/chain",
  };

  // ── 其他优化 ───────────────────────────────────────────
  // 关闭 watcher（减少后台文件监控开销）
  config.watcher = {
    type: "default",
  };

  // 关闭 logrotator
  config.logrotator = {
    filesRotateBySize: [],
    filesRotateByHour: [],
  };

  return config;
};
