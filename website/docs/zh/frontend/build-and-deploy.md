# 构建与发布

`vext build` 会在一个命令中编译服务端产物和前端产物。

## 输出

启用 frontend 后，生产输出包含：

```text
dist/
  server/
  client/
    index.html
    manifest.json
    render-manifest.json
    deploy-manifest.json
    size-report.json
    assets/
```

`vext start` 会服务已构建的 client assets，并使用 `render-manifest.json` 做 SSR。生产模式会在 listen 前检查 `index.html`、`render-manifest.json`、route asset metadata 和 server renderer 文件；缺失或无效时会失败，并提示重新运行 `vext build`。

## 构建命令

```bash
vext build
```

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

## Deploy Manifest

`deploy-manifest.json` 记录可上传静态资源：

- JS 和 CSS assets
- import 的图片、字体、媒体文件
- 复制过来的 `public/**` 文件
- content type
- sha256
- 可用资源的 SRI
- upload key 和 public URL

HTML 默认不上传，因为 SSR 仍属于服务端 runtime。

## 增量上传

上传 state file 会记录已知 sha256。未变化的资源会跳过，因此图片和字体不会每次发布都重新上传。

`stateFile` 应放在 frontend outDir 外，因为 build 输出通常会清理。

## 配置

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
