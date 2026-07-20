# 开发工作流

## 目录导航

- [`vext dev`](#vext-dev)
- [前端重建](#前端重建)
- [React Fast Refresh](#react-fast-refresh)
- [CSS 更新](#css-更新)
- [Render Refresh](#render-refresh)
- [Leak Scan 诊断](#leak-scan-诊断)
- [什么时候会整页刷新](#什么时候会整页刷新)

## `vext dev`

`vext dev` 会同时启动后端 runtime 和前端开发流水线。前端输出写入 `.vext/client/`。

```bash
npm run dev
```

开发模式会监听：

- `src/frontend/**`
- `public/**`
- 影响 render 数据的 route 和 service 文件
- 影响前端设置的 config 文件

## 前端重建

仅前端变更会重建浏览器输出，不重启后端进程。

| 变更                  | 预期动作                           |
| --------------------- | ---------------------------------- |
| page/component/layout | 前端重建                           |
| `.module.css`         | 前端重建 / CSS 更新                |
| JSCSS style 文件      | JSCSS 抽取 + CSS 更新              |
| `public/**`           | 复制 + 前端重建                    |
| locale 文件           | registry 重建与 hydration 数据更新 |

## React Fast Refresh

React 页面、layout 和公共组件在模块 refresh-safe 时使用 Fast Refresh。

以下情况可能退回整页刷新：

- 模块导出非组件值，并被 React tree 外部使用
- 文件修改了 document/runtime 关键行为
- 变更跨越 server/client 边界
- React 无法安全保留组件状态

## CSS 更新

仅 CSS 更新不应重启后端。Vext 会根据来源更新 stylesheet link 或重建 CSS 资源。

组件局部样式优先用 CSS Modules 或 JSCSS；全局 CSS 用于基础样式和 token。

## Render Refresh

当后端 route/service 代码变更影响 `res.render()` 数据时，Vext 可以在 backend soft reload 后通知浏览器。

```ts
frontend: {
  dev: {
    renderRefresh: "prompt",
  },
}
```

| 值         | 行为                 |
| ---------- | -------------------- |
| `"prompt"` | 在浏览器显示刷新提示 |
| `"auto"`   | 自动刷新             |
| `"off"`    | 只记录事件           |

admin 或表单较多的页面建议用 `"prompt"`，避免自动刷新打断操作。

## Leak Scan 诊断

`frontend.build.diagnostics.leakScan` 默认开启，用于阻断浏览器 bundle import 服务端模块。

常见错误：

```tsx
import { db } from "../../services/db";
```

友好诊断应说明这跨越了物理边界，并提示把 service 调用移回 `src/routes/**`，再通过 `res.render()` 传数据。

## 什么时候会整页刷新

Vext 无法安全保留状态时，整页刷新是正常行为。

常见触发：

- `_document.html` 变更
- 生成入口形状变化
- route/service 代码改变 render 数据，且 `renderRefresh="auto"`
- Fast Refresh 拒绝某个模块
- config 变更重建前端 runtime 边界

如果每次组件变更都会整页刷新，检查 `frontend.dev.hot`、`frontend.dev.fastRefresh`，以及组件是否 import 了服务端代码。设置 `frontend.dev.overlay: false` 可以保留 SSE 刷新行为，但关闭浏览器 overlay 提示。
