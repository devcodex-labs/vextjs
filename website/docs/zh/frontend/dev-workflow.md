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

在已完成[全栈快速开始](./getting-started)、启用 `frontend.enabled` 的应用中，`vext dev` 会启动后端 runtime 和前端开发流水线。前端默认输出写入 `.vext/client/`；自定义 outDir 时以配置为准。下面的命令在应用根目录执行，框架源码仓库的同名 npm 脚本用途不同。

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

| 变更                      | 预期动作                                                 |
| ------------------------- | -------------------------------------------------------- |
| page/component/layout     | 前端重建                                                 |
| `.module.css`             | 前端重建 / CSS 更新                                      |
| JSCSS style 文件          | JSCSS 抽取 + CSS 更新                                    |
| `public/**`               | 复制 + 前端重建                                          |
| `src/frontend/locales/**` | 前端重建；已打开页面的数据是否更新还取决于导航或重新请求 |

上述规则适用于默认目录；自定义目录以项目解析结果为准。`src/routes/**`、`src/services/**` 等后端源码走 soft reload，配置/插件等初始化文件走冷重启；服务端 `src/locales/**` 与前端 locale 目录也不同。完整分类见[热重载](../guide/hot-reload)。

## React Fast Refresh

React 页面、layout 和公共组件在模块 refresh-safe 时使用 Fast Refresh。

以下情况可能退回整页刷新：

- 模块形态或导出变化使 React 无法保留状态
- 文件修改了 document/runtime 关键行为
- 新入口加载或 refresh runtime 执行失败
- React 无法安全保留组件状态

## CSS 更新

仅 CSS 更新不应重启后端。Vext 会根据来源更新 stylesheet link 或重建 CSS 资源。

组件局部样式优先用 CSS Modules 或 JSCSS；全局 CSS 用于基础样式和 token。

只有本次变更文件全部属于 `.css`、`.pcss` 或 `.postcss` 才直接走 style 事件。JSCSS 的 TypeScript 源变更会重建并更新 CSS，但还可能进入 Fast Refresh 或整页刷新，不能保证仅替换样式。

## Render Refresh

当后端 route/service 代码变更影响 `res.render()` 数据时，Vext 可以在 backend soft reload 后通知浏览器。

```ts
export default {
  frontend: {
    enabled: true,
    dev: {
      renderRefresh: "prompt",
    },
  },
};
```

| 值         | 行为                                                              |
| ---------- | ----------------------------------------------------------------- |
| `"prompt"` | 默认 overlay 显示刷新提示；关闭 overlay 时改为浏览器 console 提示 |
| `"auto"`   | 自动刷新                                                          |
| `"off"`    | 不发布 render reload 事件，不主动通知浏览器                       |

admin 或表单较多的页面建议用 `"prompt"`，避免自动刷新打断操作。

## Leak Scan 诊断

`frontend.build.diagnostics.leakScan` 默认开启，用于阻断浏览器 bundle import 服务端模块。

常见错误：

```tsx
import { db } from "../../services/db";
```

这是用于说明错误的导入片段。Leak Scan 命中时构建失败，不能把它视为“自动整页刷新即可恢复”；应把 service 调用移回 `src/routes/**`，再通过 `res.render()` 传数据。检测范围与限制见[诊断与 Leak Scan](./diagnostics-and-leak-scan)。

## 什么时候会整页刷新

Vext 无法安全保留状态时，整页刷新是正常行为。

常见触发：

- 保留 `hot: true` 但关闭 `fastRefresh` 后的非纯 CSS 重建
- 新入口 import 或 refresh 执行失败
- route/service 代码改变 render 数据，且 `renderRefresh="auto"`

`_document.html` 或配置边界变更后应主动完整刷新，核对新的 document 和 runtime；不能依赖组件更新替换整个 HTML 文档。配置还可能触发后端冷重启。`hot: false` 会移除浏览器 SSE/Refresh 接入，需要手动刷新，不等于每次自动整页刷新。

如果每次组件变更都会整页刷新，检查 `frontend.dev.hot`、`frontend.dev.fastRefresh`，以及组件是否 import 了服务端代码。设置 `frontend.dev.overlay: false` 可以保留 SSE 刷新行为，但关闭浏览器 overlay 提示。

## 验证一次修改

打开已启用默认 hydration 的页面，先确认 Console 无错误和 `/__vext/dev/events` SSE 连接正常。修改可见组件文本，观察前端 rebuild 及页面更新；只改 CSS 时观察样式变化和后端进程保持。再修改路由传入的 props，soft reload 成功后按 prompt 提示手动刷新，确认新数据。遇到编译错误先修正再继续，不将旧页面仍能显示当作本次更新成功。

`hydration: "none"` 页不加载浏览器 runtime，不会消费这些刷新通知，需要手动刷新。保留状态只是符合条件时的结果，不能用它替代输出正确性验证。结束后停止开发服务。
