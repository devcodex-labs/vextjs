---
pageType: home

hero:
  name: VextJS
  text: 现代化 Node.js Web 框架
  tagline: 开箱即用，专为构建高性能 RESTful API 而设计
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/vextjs/vext

features:
  - title: 🔌 Adapter 架构
    details: 底层 HTTP 框架可替换 — 内置 Native、Hono、Fastify、Express、Koa 五种 Adapter，切换仅需一行配置，业务代码零改动。
  - title: ⚡ 极致性能
    details: Native Adapter 基于 http.createServer + route-core 路由核心，零外部 HTTP 框架依赖；仓库内 benchmark 覆盖 json / params / chain / middleware-chain 四类场景。详见 [性能基准](/benchmark)。
  - title: 🛡️ 参数校验
    details: 集成 schema-dsl 声明式校验，在路由 options 中定义 body / query / params 规则，自动验证 + OpenAPI 文档生成，一处定义多处受益。
  - title: 🧩 插件系统
    details: 通过 definePlugin() 扩展框架能力 — 注册服务、添加路由、挂载中间件，生命周期钩子（setup / onReady / onClose）精确控制。
  - title: 🔥 开发体验
    details: vext dev 开箱即用 — 文件监听 + 热重载（Soft Reload Tier 1/2 + Cold Restart Tier 3）、TypeScript 零配置编译、esbuild 极速构建。
  - title: 🏢 企业就绪
    details: Cluster 多进程部署、优雅关闭、Rolling Restart、心跳监控、OpenAPI 文档自动生成、国际化、内置限流 — 生产级特性开箱即用。
---
