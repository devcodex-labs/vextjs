# 诊断与 Leak Scan

Leak Scan 在前端构建时检查已识别的服务端路径，避免它们意外进入浏览器 bundle。本页用于已启用前端的应用排查构建失败；它不是任意第三方包、动态代码或敏感内容的完整分析器。

## 默认行为

```ts
export default {
  frontend: {
    enabled: true,
    build: {
      diagnostics: {
        leakScan: true,
      },
    },
  },
};
```

`leakScan` 默认开启。构建器通过源码预检查、esbuild 解析插件和构建输入 metafile 检查已识别的导入；命中时本次构建失败。先修复依赖方向再重建，不应依赖关闭检查来让服务端代码在浏览器运行。

## 会阻断的导入

常见阻断对象包括：

- `src/routes/**`
- `src/services/**`
- `src/config/**`
- `node:fs` 这类 Node built-ins
- `*.server.*` 文件

当前服务端目录判断固定识别上述三个默认路径，不能推导为自定义目录或所有后端目录都会自动识别。数据库客户端没有统一的包名黑名单；是否被阻断取决于实际导入的路径、Node 依赖和 bundler 能力。通过检查也不代表整个 bundle 已经没有服务端逻辑，需要审查浏览器依赖和产物。

## 友好错误形态

如果页面直接 import 已存在的 service（以下是用于复现错误的片段，需实际使用 `db`，避免未使用导入被工具移除）：

```tsx
// src/frontend/pages/dashboard.tsx
import { db } from "../../services/db";
export default function DashboardPage() {
  return <pre>{JSON.stringify(db)}</pre>;
```

当前错误的核心内容类似下面这样；路径与 importer 随项目变化：

```text
[vextjs] Frontend boundary leak: browser bundle imported "src/services/db" (server-only directory src/services/**).
你跨越了前后端物理边界：浏览器入口、页面和公共组件不能直接 import src/routes/**、src/services/**、src/config/**、node:* 或 *.server.*。
请把服务端数据读取放到 route handler / service 调用链中，再通过 res.render(page, props, options) 传给页面。
Importer: src/frontend/pages/dashboard.tsx
```

目标是告诉用户“跨越了物理边界”，而不是只抛底层 bundler 错误。

该消息不是公开的 `VEXT_FRONTEND_BOUNDARY` 错误码合同；集成时不要依赖原文不存在的错误码。

## 修复方式

| 问题                        | 修复                                           |
| --------------------------- | ---------------------------------------------- |
| 页面 import service         | 移到 route handler 中调用，并通过 props 传入。 |
| 组件 import config          | 通过 props 或安全生成数据传入公开配置。        |
| shared util import `node:*` | 拆成 `*.server.ts` 和浏览器安全 util。         |
| API helper 拿到 HTML        | 检查 `Accept` header 和 SPA fallback scope。   |

最后一项是运行时响应诊断，与 Leak Scan 的构建期检查不同；还应核对实际 API URL 和响应状态。

## 验证修复

在应用根目录执行 `npm run build`：命中边界时应失败，并指出实际文件或 importer。把服务调用移回 route，将 JSON 可序列化结果传给页面，参考[数据流](./data-flow)的完整示例；重新构建应成功。随后访问页面，确认正文与 Console，而不是只删除报错行让构建通过。开发模式下旧页面可能仍可见，必须核对最近一次 rebuild 成功记录。
