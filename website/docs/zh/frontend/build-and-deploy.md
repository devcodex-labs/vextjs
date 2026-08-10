# 构建与发布

`vext build` 会在一个命令中编译服务端产物和前端产物。本页给出生产交付路径；字段级说明见[前端配置](./configuration)，缓存和媒体行为见[静态资源与 CDN](./static-assets-and-cdn)。

## 输出

启用 frontend 后，生产输出包含：

```text
dist/
  config/ routes/ services/ ...     # 服务端文件保持源码目录映射
  client/
    index.html
    assets/                         # 浏览器 JS、CSS 与 import 型资源
    manifest.json
    render-manifest.json
    server/renderer.cjs             # 默认值；可由 build.server.outFile 配置
    deploy-manifest.json
    messages-manifest.json
    media-manifest.json
    static-manifest.json
    size-report.json                # build.diagnostics.sizeReport 开启时
    client-contract.json            # apiClient 开启时（默认开启）
    route-contract.json             # apiClient 开启时（默认开启）
    api.generated.ts                # apiClient 开启时（默认开启）
```

只有 `dist/client/` 是固定的前端边界。后端编译器会在 `dist/` 下保持应用源码目录映射，并**不会**固定生成顶层 `dist/server/`。SSR renderer 默认位于前端输出内，因此可以由 `render-manifest.json` 与 client assets 作为同一个 closure 描述和校验。

当对应功能没有声明输入时，`messages-manifest.json`、`media-manifest.json` 与 `static-manifest.json` 可能为空，但仍是有效构建证据。关闭 `frontend.build.diagnostics.sizeReport` 时会故意不生成 `size-report.json`。Source map 同样取决于配置：浏览器生产构建默认不生成，后端 CLI 编译默认生成外部 source map。

`vext start` 会服务已构建的 client assets，并使用 `render-manifest.json` 做 SSR。生产模式会在 listen 前检查 `index.html`、`render-manifest.json`、route asset metadata 以及其引用的 server renderer；任一缺失或无效都会失败，需重新执行 `vext build` 生成完整 closure。

## 选择交付形态

| 需求                                  | 默认值 / 配置                           | 会发生什么                                                     | 如何验证                                |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------- | --------------------------------------- |
| 一个 Node 服务同时提供 HTML 和 assets | 不设置 `assetBaseUrl`                   | `vext start` 同源服务 `dist/client/**`                         | 从应用 origin 请求页面和一个 hash asset |
| CDN 提供 immutable assets             | 设置绝对 `frontend.deploy.assetBaseUrl` | 生成的 JS/CSS URL 指向 CDN；HTML 与 SSR 仍由 Node runtime 负责 | 检查生成 HTML，再通过 CDN URL 请求资源  |
| 增量上传 assets                       | `frontend.deploy.upload.enabled: true`  | 由 `deploy-manifest.json` 按内容 hash 驱动上传                 | 先执行 dry-run，再执行真实上传          |

第一行就是默认路径：可工作的全栈服务不需要 CDN，也不需要 upload adapter。

## 构建后启动

```bash
vext build
vext start
```

这是完整的同源生产路径。build 生成后端 JavaScript 与前端 closure；start 在接受流量前会校验该 closure。

构建后上传静态资源：

```bash
vext build --upload-assets
```

或单独执行上传：

```bash
vext deploy assets --dry-run
vext deploy assets
```

`vext deploy assets` 只接受 option 参数，不接受额外位置参数。需要取值的参数必须提供非 option 值；例如 `--manifest --dry-run`、`--target-dir --dry-run` 会直接失败，而不是把后一个 flag 当作路径。

## CDN 与增量上传

`deploy-manifest.json` 记录可上传静态资源：

- JS 和 CSS assets
- import 的图片、字体、媒体文件
- 复制过来的 `public/**` 文件
- content type
- sha256
- 可用资源的 SRI
- upload key 和 public URL

HTML 默认不上传，因为 SSR 仍属于服务端 runtime。Source map 默认也不上传；除非单独制定发布策略，否则应保留在诊断路径。

## 安全发布顺序

1. 只有确定由 CDN 服务浏览器资源时，才设置绝对 `frontend.deploy.assetBaseUrl`。
2. 把 `frontend.deploy.upload.stateFile` 放在 `frontend.outDir` 外，避免 build 清理时删除上传历史。
3. 只构建一次：`vext build`。
4. 先审阅准确上传集合：`vext deploy assets --dry-run`。
5. 执行 `vext deploy assets`，再部署匹配同一版本的 `dist/` Node runtime。不要用新 CDN manifest 搭配旧 server renderer。
6. 请求一个 SSR 页面和一个 hash asset，确认生成的资源 URL、缓存头与（如已开启）SRI 来自同一次发布。

内置 adapter 只有 `filesystem` 与 `mock`。`filesystem` 适合生成 staging deploy tree，但不是隐藏的 CDN 集成。云厂商需要显式实现 custom upload adapter；该路径不会安装或假定 bundler/cloud plugin ecosystem。

## 增量上传

上传 state file 会记录已知 sha256。未变化的资源会跳过，因此图片和字体不会每次发布都重新上传。

`stateFile` 应放在 frontend outDir 外，因为 build 输出通常会清理。

## 配置示例

```ts
frontend: {
  deploy: {
    assetBaseUrl: "https://cdn.example.com/my-app/",
    integrity: true,
    upload: {
      enabled: true,
      adapter: "filesystem",
      targetDir: ".vext/frontend-cdn",
      publicBaseUrl: "https://cdn.example.com/my-app/",
      prefix: "my-app",
      stateFile: ".vext/deploy/frontend-assets-state.json",
      exclude: ["**/*.map"],
    },
  },
}
```

`assetBaseUrl` 必须是绝对 URL。`publicBaseUrl` 是 upload plan 报告的公开地址，`targetDir` 只是内置 filesystem adapter 使用的本地目标目录。只有默认的整份 manifest 上传不适用时，才增加 `include`、`exclude` 与 `concurrency`。
