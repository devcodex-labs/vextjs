# Render Refresh

Render Refresh 处理会影响 `res.render()` HTML 输出的服务端变更。

## 什么会触发

例如：

- route handler 修改了传给 `res.render()` 的 props
- 页面 route 使用的 service 修改
- layout data 结构修改
- 服务端 locale / message 解析修改
- render cache 失效影响当前页面

这些变更发生在服务端，因此 React Fast Refresh 不够。

## 配置

```ts
export default {
  frontend: {
    dev: {
      renderRefresh: "prompt",
    },
  },
};
```

| 值         | 行为                                     |
| ---------- | ---------------------------------------- |
| `"prompt"` | 后端 reload 成功后，浏览器显示开发提示。 |
| `"auto"`   | 自动刷新当前页面。                       |
| `"off"`    | 只在终端记录，不刷新浏览器。             |

## 推荐默认值

应用开发建议使用 `"prompt"`。它不会突然刷新页面状态，同时能提示 SSR 数据已变旧。

演示、设计 review 或快速搭页面时可以使用 `"auto"`。

长时间调试客户端状态时可以使用 `"off"`。

## 正常请求不会触发刷新

普通请求中调用 `res.render()` 不会触发开发刷新。触发点是能够改变渲染输出的代码 rebuild 或后端 reload 成功。
