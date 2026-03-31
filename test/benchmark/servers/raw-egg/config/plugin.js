/**
 * egg.js 基准测试插件配置
 *
 * 禁用所有非必要插件，最小化框架开销，
 * 聚焦核心路由 + 中间件性能测量。
 *
 * egg 默认启用的插件较多（onerror / session / i18n / watcher / ...），
 * 基准测试中大部分不需要，禁用后减少初始化和每请求开销。
 */

// 禁用 session（基准测试无需会话管理）
exports.session = {
  enable: false,
};

// 禁用 i18n（基准测试无需国际化）
exports.i18n = {
  enable: false,
};

// 禁用 watcher（基准测试无需文件监控）
exports.watcher = {
  enable: false,
};

// 禁用 multipart（基准测试无需文件上传）
exports.multipart = {
  enable: false,
};

// 禁用 development（生产模式运行）
exports.development = {
  enable: false,
};

// 禁用 logrotator（基准测试无需日志轮转）
exports.logrotator = {
  enable: false,
};

// 禁用 static（基准测试无需静态文件服务）
exports.static = {
  enable: false,
};

// 禁用 view（基准测试无需模板渲染）
exports.view = {
  enable: false,
};

// 禁用 schedule（基准测试无需定时任务）
exports.schedule = {
  enable: false,
};

// 保留 onerror（框架基础错误处理，禁用可能导致崩溃）
// exports.onerror = { enable: true };
