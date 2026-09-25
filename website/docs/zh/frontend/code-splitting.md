# 代码拆分

Vext 围绕页面、layout、错误页、locale 和共享 runtime chunk 拆分前端代码。

本页用于已启用前端的应用判断首屏加载范围。先完成[全栈快速开始](./getting-started)，再构建并检查实际产物；通常保留默认拆分设置即可。

## Page Lazy Registry

页面通过生成的浏览器 registry 懒加载。这样初始 route 不会在启动时 import 所有页面。

```text
src/frontend/pages/admin/dashboard.tsx
  -> generated lazy entry
  -> route asset graph
```

## 默认行为与关闭边界

`frontend.build.client.splitting` 默认是 `true`。生成的 page、layout 与 error registry 使用动态 `import()`，因此浏览器端默认按页面入口拆分代码；共享依赖可能合并为 chunk，不保证每个 URL 恰好对应一个文件。保留默认 hydration 的 SSR 会为首屏注入 route-specific `modulepreload`；这改善首次渲染的预取，不会把 registry 变成 eager import。`hydration: "none"` 页不输出这些 JS preload。

只有部署环境存在明确的打包兼容或诊断原因时，才设置 `frontend.build.client.splitting: false`。它会关闭客户端代码拆分，并可能让更多 route module 合并进初始浏览器输出；它不是让懒加载“更可靠”的开关。

## Layout 与错误页

Layout 和错误页也属于 registry。Route assets 记录 page、layout chain、共享 CSS 与 runtime chunks；其中 JS 使用 modulepreload，CSS 使用 stylesheet link。错误页等延迟模块在实际需要时加载。

## Vendor Chunks

默认开启 `frontend.build.vendorChunks.enabled`，为配置的包生成 vendor 入口，再由 esbuild 根据共享依赖拆分。通常能复用 React/runtime chunk，但这不是固定 chunk 文件名或大小合同，仍需检查产物依赖闭包。

## External Runtime

高级部署可以把浏览器依赖标记为 external，并提供运行时 URL。下面是配置结构示例，所有 URL 必须替换成实际兼容的浏览器 ESM 模块，并保持 React/React DOM 及 JSX runtime 版本一致；未准备好这些资源时保留默认打包：

```ts
export default {
  frontend: {
    enabled: true,
    build: {
      client: {
        external: [
          "react",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ],
        externalRuntime: {
          react: "https://cdn.example.com/react.mjs",
          "react-dom/client": "https://cdn.example.com/react-dom-client.mjs",
          "react/jsx-runtime": "https://cdn.example.com/react-jsx-runtime.mjs",
          "react/jsx-dev-runtime":
            "https://cdn.example.com/react-jsx-dev-runtime.mjs",
        },
      },
    },
  },
};
```

将配置合并进 `src/config/default.ts`。Vext 会检查显式 external 列表中的 React 相关项是否有映射，并把映射写成 import map/preload；缺少必需映射会构建失败。它不会下载 CDN 模块或验证远端模块内部依赖。检查实际产物中所有保留的 bare import，包括包的子路径及远端模块自身的依赖，并补齐对应映射或可解析 URL；“本地 build 成功”不等于 CDN 能运行。

## Route Assets

Render manifest 会把 route 映射到 initial assets。SSR 使用该 graph 注入 route-specific `modulepreload`，避免 hydration 后才发现 page chunk。

## 预算失败时

如果 route initial chunk 过大：

- 检查重型组件是否可以延后 import
- 把后台专用依赖移出公开页面
- 同时启用 `frontend.build.diagnostics.sizeReport` 和 `performanceReport` 后，查看 `size-report.json` 的 `routes[]` 指标
- 只有部署环境能可靠服务时才使用 external runtime

## 验证拆分结果

在应用根目录执行 `npm run build`，查看默认 `dist/client/render-manifest.json` 的 `routeAssets` 与 `size-report.json` 的 `routes[]`，把具体 page 与初始 JS 闭包对应起来；自定义 outDir 时使用实际目录。启动应用后从新标签直接访问某页，检查 Network 的 JS/CSS 与 preload，再导航到另一页观察新增资源。预加载、缓存和共享 chunk 都会影响请求数量，不能只按请求数推断总字节。

若比较 `splitting: false`，每次更改后重新构建并使用新产物，记录体积和交互结果；恢复所选配置后停止服务。大小预算口径见[性能预算](./performance-budgets)，浏览器行为见[Hydration 验证](./hydration-validation)。
