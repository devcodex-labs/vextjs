# 诊断与 Leak Scan

Leak Scan 用来阻止服务端模块意外进入浏览器 bundle。

## 默认行为

```ts
export default {
  frontend: {
    build: {
      diagnostics: {
        leakScan: true,
      },
    },
  },
};
```

开启后，Vext 会在输出浏览器产物前检查前端 import graph。

## 会阻断的导入

常见阻断对象包括：

- `src/routes/**`
- `src/services/**`
- `src/config/**`
- 数据库客户端
- `node:fs` 这类 Node built-ins
- `*.server.*` 文件

## 友好错误形态

如果页面直接 import service：

```tsx
import { db } from "../../services/db";
```

Vext 应提示：

```text
VEXT_FRONTEND_BOUNDARY
Browser bundle imported a server-only module.
Importer: src/frontend/pages/dashboard.tsx
Import: ../../services/db
Resolved: src/services/db.ts
Reason: src/services/** belongs to the server graph.
Fix: call the service in src/routes/** and pass data with res.render().
```

目标是告诉用户“跨越了物理边界”，而不是只抛底层 bundler 错误。

## 修复方式

| 问题                        | 修复                                           |
| --------------------------- | ---------------------------------------------- |
| 页面 import service         | 移到 route handler 中调用，并通过 props 传入。 |
| 组件 import config          | 通过 props 或安全生成数据传入公开配置。        |
| shared util import `node:*` | 拆成 `*.server.ts` 和浏览器安全 util。         |
| API helper 拿到 HTML        | 检查 `Accept` header 和 SPA fallback scope。   |
