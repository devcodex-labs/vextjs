# Fast Refresh

Fast Refresh 是 `vext dev` 中 React 页面、layout 和组件修改的默认反馈路径。

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
    dev: {
      hot: true,
      fastRefresh: true,
    },
  },
};
```

## 降级场景

以下情况可能降级为整页刷新：

- 模块导出非组件值，且被 React tree 外部使用
- 修改了 document / runtime 边界
- 文件 import 了服务端代码
- refresh runtime 报告不可恢复错误

浏览器 overlay 或终端提示应说明发生了什么以及如何恢复。

## 推荐组件形态

```tsx
export function UserCard(props: { name: string }) {
  return <article>{props.name}</article>;
}
```

service 调用留在 route 中，把数据作为 props 传给组件。这样前端模块更容易 refresh，也更安全。
