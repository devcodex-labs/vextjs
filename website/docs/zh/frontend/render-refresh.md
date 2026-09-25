# Render Refresh

Render Refresh 在开发模式的后端 soft reload 成功后，按文件范围通知浏览器重新获取页面。它要求前端已启用、`frontend.dev.hot: true` 且当前页面加载浏览器 runtime；生产模式和 `hydration: "none"` 页面不消费该通知。

## 什么会触发

当前触发判断按变更路径识别 `src/routes/**`、`src/services/**`、`src/middlewares/**`，以及全量 `src` reload；并不分析某个文件是否真正影响当前页面。典型例子：

- route handler 修改了传给 `res.render()` 的 props
- 页面 route 使用的 service 修改
- 上述路由/服务传入的 layout data 结构修改
- 上述中间件中的 render 数据处理修改

这些变更发生在服务端，因此只更新 React 组件不能获取新的服务端数据。单独修改 `src/locales/**`、操作运行时缓存或数据库，不会仅因此发布 render reload；需要手动重新请求页面。自定义后端目录虽然可参与 reload，但这里的通知判定仍使用上述默认路径，不能假定自定义目录也一定触发提示。

## 配置

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

| 值         | 行为                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| `"prompt"` | 匹配的 soft reload 成功后显示开发提示；overlay 关闭时改为浏览器 console 提示。 |
| `"auto"`   | 自动刷新当前页面。                                                             |
| `"off"`    | 不发布 render reload 事件，不主动通知浏览器。                                  |

## 推荐默认值

默认值为 `"prompt"`。它不会突然刷新页面状态；提示表示相关代码已重新加载，不证明当前页面数据一定变化。

演示、设计 review 或快速搭页面时可以使用 `"auto"`。

长时间调试客户端状态时可以使用 `"off"`。

## 正常请求不会触发刷新

普通请求中调用 `res.render()` 不会触发开发刷新。当前触发点是上述路径的 soft reload 成功；失败不会发布成功通知。配置变更的冷重启属于另一流程，见[开发工作流](./dev-workflow)，不能将其等同于这里的事件。

## 验证通知与新数据

沿用[数据流](./data-flow)的 dashboard 示例，在应用根目录运行 `npm run dev` 并打开 `/dashboard`。将路由内的计数值改为另一个固定值，等待终端 soft reload 成功：prompt 模式应出现提示，点击提示后才重新加载页面并显示新值；auto 模式自动完整刷新；off 模式需手动刷新。切换配置会重启开发环境，先确认已加载新配置再比较行为。

同时检查 Console 和 SSE 连接；提示不代表重新请求一定成功，刷新后仍需核对响应状态与正文。恢复示例数据后停止服务。这里不提供生产环境的数据推送、缓存订阅或业务实时通知能力。
