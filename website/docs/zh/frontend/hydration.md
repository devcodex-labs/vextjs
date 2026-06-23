# Hydration

Hydration 会把浏览器端 React tree 接到 SSR 产出的 HTML 上。

## 会复用什么

Vext 会把 render payload 写入 document，让 client entry 不需要重复执行首屏 service 调用：

- page id
- props
- layoutData
- locale 和 messages
- 初始 route 使用的 head metadata
- build id 和 route assets

## 避免 Mismatch

保持 SSR 与浏览器输出确定：

| 风险 | 更好的做法 |
|------|------------|
| render 中直接使用 `Date.now()` | 在 route handler 中传入时间。 |
| 组件 render 中生成随机 id | 在 render 前生成稳定 id，或放到 effect 中。 |
| SSR 阶段访问浏览器 API | 放到 effect 或 client-only 分支。 |
| locale 对象结构不同 | 每个 locale 文件都与默认 locale 对齐。 |

## Hydration 标记

Vext 提供低噪音诊断标记：

```text
data-vext-hydration="hydrating"
data-vext-hydration="done"
performance.measure("vext:hydration")
```

生产环境不需要默认输出 console 性能日志。验证脚本读取 DOM 与 Performance API。

## Route Assets

Render manifest 会记录每个 route 的 initial JS/CSS。SSR 可以注入 route-specific `modulepreload`，避免 hydration 后才发现 page chunk。

如果生产 `vext start` 发现 manifest 过旧且缺少 route assets，会 fail fast 并提示重新构建。

## 验证

使用消费者验证入口：

```bash
npm --prefix E:\Worker\vext-test run verify:frontend-performance
```

它检查真实浏览器导航、前端资源状态、route preload、hydration marker 和 `size-report.json`。
