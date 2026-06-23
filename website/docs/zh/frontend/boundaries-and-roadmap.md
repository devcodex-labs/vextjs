# 边界与路线图

本页区分当前前端目标和后续能力方向。

## 当前目标

当前 Vext 前端方向是：

- `src/frontend/**` 作为用户前端源码根
- `src/routes/**` 作为 URL 和服务端数据入口
- `res.render(page, props?, options?)`
- React 19 SSR + hydration
- 嵌套 layout chain
- 默认错误页与 `renderError()`
- Vext JSCSS + CSS/CSS Modules
- `useVextI18n(locale?)` 前端多语言
- 开发期 Fast Refresh 与 render refresh
- esbuild-powered 生产构建
- route assets、代码拆分、size report、预算、deploy manifest、SRI 和静态资源增量上传

## 版本边界

本专区描述当前 Vext 文档对应的前端能力。判断某个已安装包版本具体支持哪些前端功能时，以该版本 release notes 和 changelog 为准。

## API-only 项目

纯 API 项目仍是一等能力：

```bash
npx vextjs create my-api --template api --frontend none
```

也可以在配置中关闭：

```ts
export default {
  frontend: false,
};
```

## 外部前端适配

Vext 可以通过 `vextjs/frontend`、生成 API artifacts 和稳定 HTTP 边界支持外部前端框架。默认内置体验仍然是 Vext 自己管理的 full-stack React。

## 后续方向

以下不属于首期承诺，但后续可独立评估：

- React Server Components
- Server Actions
- streaming SSR
- 持久客户端 layout 导航
- 内置图片/字体优化组件
- 更深的外部前端框架适配

每个方向都需要独立需求、性能证据和兼容性复审，才能成为默认行为。

## 当前不做

- 把服务端 import 隐藏进浏览器 bundle
- 让页面文件自动创建路由
- 把全局 SPA fallback 当默认模式
- 默认把 SSR HTML 当静态资源上传
- 为静态资源上传把云厂商 SDK 放进 core
