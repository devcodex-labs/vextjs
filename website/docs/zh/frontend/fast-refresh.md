# Fast Refresh

Fast Refresh 是已启用前端的应用在 `vext dev` 中更新 React 页面、layout 和组件的默认反馈路径。它依赖 `frontend.dev.hot`、`fastRefresh` 均开启，以及页面加载了浏览器 runtime；生产模式和 `hydration: "none"` 页面不使用这条路径。首次使用先完成[全栈快速开始](./getting-started)。

## 处理什么

| 变更                   | 期望行为                          |
| ---------------------- | --------------------------------- |
| 页面组件修改           | 模块满足条件时 React Fast Refresh |
| 公共组件修改           | 影响到的页面尽量 Fast Refresh     |
| CSS 或 CSS Module 修改 | 尽量走 CSS update                 |
| JSCSS 修改             | 前端重建并更新样式                |

前端文件修改时，Vext 会保持后端进程继续运行。

## 配置

```ts
export default {
  frontend: {
    enabled: true,
    dev: {
      hot: true,
      fastRefresh: true,
    },
  },
};
```

## 降级场景

当前生成入口会重新 import 构建后的入口并调用 React Refresh。入口加载或 refresh 执行失败时，会记录错误并整页刷新；关闭 `fastRefresh` 但保留 `hot` 时，非纯 CSS 重建也走整页刷新。

状态保留不能保证覆盖所有导出或 Hook 结构变更；组件也可能重挂载。修改 document/runtime 边界后应主动完整刷新验证，不能用组件刷新替代新 document 的加载。`hot: false` 会断开生成入口的 SSE/Refresh 接入，需要手动刷新。

导入服务端代码若命中 Leak Scan，会导致构建失败，应先修正导入，不能通过整页刷新解决。overlay 关闭时仍应检查 Console 与终端错误；详见[诊断与 Leak Scan](./diagnostics-and-leak-scan)。

## 推荐组件形态

```tsx
// src/frontend/components/UserCard.tsx
export function UserCard(props: { name: string }) {
  return <article>{props.name}</article>;
}
```

service 调用留在 route 中，把数据作为 props 传给组件。这样前端模块更容易 refresh，也更安全。

当前构建器主要为前端根目录中的 `.tsx`/`.jsx` 文件识别具名、首字母大写的组件导出并注册；不是对任意 JavaScript 模块都提供同等状态保留保证。上面的组件需要由真实页面 import 并使用，单独创建未引用文件不会让页面出现它。

## 验证更新

在应用根目录运行 `npm run dev`，打开使用该组件且保留默认 hydration 的页面。修改 `<article>` 中的可见文本，确认终端重建成功、页面出现新文本、Console 无刷新错误。已有交互状态可用于观察是否保留，但输出是否正确仍需单独核对。只改 CSS 时按[开发工作流](./dev-workflow)检查样式更新；修改 route/service 的数据则看 [Render Refresh](./render-refresh)。结束后停止开发服务。
