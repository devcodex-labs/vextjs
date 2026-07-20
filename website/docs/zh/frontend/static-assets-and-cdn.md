# 静态资源与 CDN

Vext 有两个静态资源位置，它们行为不同。

## 资源位置

| 位置                     | 行为                                      |
| ------------------------ | ----------------------------------------- |
| `src/frontend/assets/**` | 被 TSX/CSS import，进入前端 asset graph。 |
| `public/**`              | 按 public 文件复制，并通过 URL 访问。     |

组件拥有的图片、字体、媒体文件建议放在 import 型 assets 中。固定 URL 文件，如 `favicon.svg`、`robots.txt` 或外部引用文件，放在 `public/**`。

## Import 型资源

```tsx
import logoUrl from "@assets/logo.png";

export function Logo() {
  return <img src={logoUrl} alt="Logo" />;
}
```

生产构建会输出内容哈希文件，方便浏览器和 CDN 长缓存。带内容哈希的 bundle 资源会使用长期 immutable 缓存响应头。

前端 static mount 会发送 `ETag` 和 `Last-Modified` validator。条件请求 `If-None-Match` 与 `If-Modified-Since` 可返回无实体 body 的 `304`。

## Public 文件

```text
public/favicon.svg -> /favicon.svg
public/docs/openapi.json -> /docs/openapi.json
```

Public 文件会进入 deploy manifest，可以和其它前端资源一起上传。

Public 文件保持稳定 URL，因此运行时默认使用重新验证缓存响应头：

```http
Cache-Control: no-cache, max-age=0, must-revalidate
```

需要 immutable 长缓存的文件请通过 import 型 assets 进入内容哈希输出。Source map 与未带内容哈希的文件同样使用重新验证缓存响应头。

## CDN URL

生产资源由 CDN 服务时设置 `frontend.deploy.assetBaseUrl`：

```ts
frontend: {
  deploy: {
    assetBaseUrl: "https://cdn.example.com/my-app/",
  },
}
```

这会改变生成的资源 URL。上传仍由 `frontend.deploy.upload`、`vext build --upload-assets` 或 `vext deploy assets` 控制。

## 增量上传

`deploy-manifest.json` 加 sha256 state 让 Vext 跳过未变化的图片、字体、JS、CSS 和 public 文件。这是企业发布中避免大文件重复上传的默认路径。
