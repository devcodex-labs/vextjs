# 代码拆分

Vext 围绕页面、layout、错误页、locale 和共享 runtime chunk 拆分前端代码。

## Page Lazy Registry

页面通过生成的浏览器 registry 懒加载。这样初始 route 不会在启动时 import 所有页面。

```text
src/frontend/pages/admin/dashboard.tsx
  -> generated lazy entry
  -> route asset graph
```

## 默认行为与关闭边界

`frontend.build.client.splitting` 默认是 `true`。生成的 page、layout 与 error registry 使用动态 `import()`，因此浏览器端默认按路由拆分代码。SSR 会为首屏注入 route-specific `modulepreload`；这只是改善首次渲染的预取，不会把 registry 变成 eager import。

只有部署环境存在明确的打包兼容或诊断原因时，才设置 `frontend.build.client.splitting: false`。它会关闭客户端代码拆分，并可能让更多 route module 合并进初始浏览器输出；它不是让懒加载“更可靠”的开关。

## Layout 与错误页

Layout 和错误页也属于 registry。Route preload 可以包含首屏所需的 page、layout chain、共享 CSS 和 runtime chunks。

## Vendor Chunks

共享 runtime 包通过 Vext-managed vendor chunks 聚合，避免每个页面 chunk 都重复打入 React/runtime 代码。

## External Runtime

高级部署可以把浏览器依赖标记为 external，并提供运行时 URL：

```ts
frontend: {
  build: {
    client: {
      external: ["react", "react-dom/client"],
      externalRuntime: {
        react: "https://cdn.example.com/react.js",
        "react-dom/client": "https://cdn.example.com/react-dom-client.js",
      },
    },
  },
}
```

React 相关 external 必须提供映射。Vext 应 fail fast，而不是产出浏览器无法解析的 bundle。

## Route Assets

Render manifest 会把 route 映射到 initial assets。SSR 使用该 graph 注入 route-specific `modulepreload`，避免 hydration 后才发现 page chunk。

## 预算失败时

如果 route initial chunk 过大：

- 检查重型组件是否可以延后 import
- 把后台专用依赖移出公开页面
- 在启用 `frontend.build.diagnostics.performanceReport` 时查看 `size-report.json` 中的 route metrics
- 只有部署环境能可靠服务时才使用 external runtime
