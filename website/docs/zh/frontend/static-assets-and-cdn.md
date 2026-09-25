# 静态资源与 CDN

Vext 有两个静态资源位置，它们行为不同。

以下以已启用前端的[全栈项目](./getting-started)和默认目录为前提。先在本地同源验证资源，再选择 CDN；示例图片和字体需由应用提供，示例域名需替换为实际部署地址。

## 资源位置

构建产物的 HTTP 静态访问和上传均以 `public-manifest.json` 为边界，不能把整个 outDir 直接公开。自定义路径下的服务端 renderer、其 source map 和内部元数据同样保持私有。HEAD 不读取文件内容，保留 GET 的文件长度、ETag、Last-Modified 和 Content-Type。

| 位置                     | 行为                                      |
| ------------------------ | ----------------------------------------- |
| `src/frontend/assets/**` | 被 TSX/CSS import，进入前端 asset graph。 |
| `public/**`              | 按 public 文件复制，并通过 URL 访问。     |

组件拥有的图片、字体、媒体文件建议放在 import 型 assets 中。固定 URL 文件，如 `favicon.svg`、`robots.txt` 或外部引用文件，放在 `public/**`。

## Import 型资源

当前仅浏览器构建配置了图片 loader，SSR 构建没有对应 loader。不能把图片 import 放进已注册 SSR 页面或其组件；即使关闭运行时 SSR，该页面仍参与服务端 bundle 构建。默认页面优先使用 Public URL，或使用下文基于媒体清单的 `Image`。

下面仅为浏览器资源 import 的形态示例，前提是已有支持该 loader、未被 SSR 入口引用的浏览器入口，并准备了 `src/frontend/assets/logo.png`：

```tsx
import logoUrl from "@assets/logo.png";

export function Logo() {
  return <img src={logoUrl} alt="Logo" />;
}
```

生产构建会输出内容哈希文件，方便浏览器和 CDN 长缓存。带内容哈希的 bundle 资源会使用长期 immutable 缓存响应头。

`@assets` 使用框架解析后的资源目录别名。上述独立资源输出以默认 `build.assets.inlineLimit: 0` 为前提；启用内联后，小文件可能成为 data URL，不再有独立 HTTP 文件。缓存头由 Node 静态服务按实际路径判断，CDN 需自行采用对应策略。

前端 static mount 会发送 `ETag` 和 `Last-Modified` validator。条件请求 `If-None-Match` 与 `If-Modified-Since` 可返回无实体 body 的 `304`。

Static request path 会在访问文件系统前完成 canonicalization。绝对路径、编码后的 traversal path 会被拒绝，解析后逃出已配置 static root 的符号链接也绝不会被服务。

## Public 文件

```text
public/favicon.svg -> /favicon.svg
public/docs/openapi.json -> /docs/openapi.json
```

Public 文件登记到公开清单后，可按 upload include/exclude 进入 deploy manifest，与其他前端资源一起上传。示例 `/docs/openapi.json` 是手工提供的静态文件，不会自动生成 OpenAPI；避免与应用已有接口或文档服务占用相同 URL。

Public 文件保持稳定 URL，因此运行时默认使用重新验证缓存响应头：

```http
Cache-Control: no-cache, max-age=0, must-revalidate
```

需要 immutable 长缓存的文件请通过 import 型 assets 进入内容哈希输出。Source map 与未带内容哈希的文件同样使用重新验证缓存响应头。

## CDN URL

生产资源由 CDN 服务时设置 `frontend.deploy.assetBaseUrl`：

```ts
export default {
  frontend: {
    enabled: true,
    deploy: {
      assetBaseUrl: "https://cdn.example.com/my-app/",
    },
  },
};
```

这会改变生成的资源 URL。上传仍由 `frontend.deploy.upload`、`vext build --upload-assets` 或 `vext deploy assets` 控制。

将配置合并到 `src/config/default.ts` 并保留其他设置。修改 URL 不会上传资源或配置 CDN；上传目标、dry-run、同版本发布顺序见[构建与发布](./build-and-deploy)。跨源脚本、SRI 或字体还需在真实 CDN 验证 CORS 和响应类型。

## 增量上传

`deploy-manifest.json` 加 sha256 state 让 Vext 在已知同一存储目标下跳过已确认且未变化的图片、字体、JS、CSS 和 public 文件；没有稳定目标身份的自定义 adapter 不跨运行跳过。dry-run 只生成计划，不上传也不记录成功状态。

Deploy manifest 被视为不可信输入。每个 asset path 都必须规范化、保持相对且唯一，并在 lexical 与 realpath 两层都被前端输出目录包含。绝对/traversal 条目、逃逸的符号链接、重复 upload key 或 size/sha256 漂移，都会在传输任何资源前终止 plan 与 upload。

内置 `filesystem` 上传按实际 `targetDir + prefix` 目录识别目标。同一服务和 profile 中，父目录加 prefix 与直接指定子目录会复用同一目标状态；本地写入按物理目录协调，同目标和祖先重叠目标不能并发上传，独立目录可并行。目录链接会规范化，不能通过别名绕开冲突。自定义 adapter 仍通过稳定 `targetIdentity` 标识存储命名空间。后端构建、前端提交和上传分别完成，不构成跨阶段原子事务。

本地状态命中后还会核对目标文件的实际大小和 SHA-256，防止另一个服务/profile 先后覆盖或删除文件后错误跳过；读取上限为该资源的预期大小。路径或读取一致性无法验证时中止计划。该校验增加本地读取成本，不要求自定义远端 adapter 提供未声明的探测 API。

## 本地媒体流水线

`config.frontend.media` 控制本地图片和字体的构建参数与预算。

图片流水线扫描 `frontend.assetsDir`（默认 `src/frontend/assets`）下的 avif/jpeg/jpg/png/webp；即使没有被 import 的匹配文件也会处理。SVG/GIF 不在这条 variants 流水线内，可作为普通资源使用。字体另由前端源码中的静态 descriptor 声明。生成图片和字体登记为公开资源，参与内容 hash/SRI 与上传计划；`media-manifest.json` 自身是内部元数据，不作为公开静态文件上传。

```ts
export default {
  frontend: {
    enabled: true,
    media: {
      maxBytes: 20 * 1024 * 1024,
      images: {
        widths: [320, 640, 960, 1280, 1600],
        formats: ["original", "webp", "avif"],
        quality: 75,
        maxInputPixels: 40_000_000,
        maxVariants: 24,
      },
      fonts: {
        maxBytes: 5 * 1024 * 1024,
      },
    },
  },
};
```

这些上限在构建期执行。`media.maxBytes` 限定生成图片与字体的总字节数（不含随后写入的 manifest）；`images.maxVariants` 针对单张图片的宽度与格式组合，`fonts.maxBytes` 针对单个输出字体。不可读输入、过大的解码像素、过多 variants 或超预算都会使构建失败。

### 图片

先准备 `src/frontend/assets/hero.png` 并重新构建，再以相对 `frontend.root` 的源路径使用 `Image`。组件通过媒体上下文（浏览器来自 document 数据）找到 variants，输出尺寸、`srcSet` 和 `sizes`；未登记的本地图会抛错。普通模式可输出多格式 picture；priority 模式优先选 webp、使用 eager/high-priority 图片，由 React SSR 输出相应 preload。placeholder 当前写入 `data-vext-image-placeholder`，背景色为灰色，不会自动实现模糊图淡入动画。

```tsx
import { Image } from "vextjs/frontend";

export function Hero() {
  return (
    <Image
      src="assets/hero.png"
      alt="产品概览"
      width={960}
      height={540}
      sizes="(max-width: 768px) 100vw, 960px"
      priority
    />
  );
}
```

Vext 从不抓取或代理远程图片。远程 `src` 必须显式提供 `defineImageLoader({ allowlist, load })`；loader 自己负责远程 URL，并且必须返回绝对 HTTP(S) URL。

allowlist 校验原始 URL 的主机名，条目也匹配其子域；loader 输出只检查 HTTP(S) 格式，应用应确保输出仍指向预期主机。远程分支直接输出 img，不运行本地 variants、尺寸探测或图片代理。

### 字体

先放入真实可读取的 `src/frontend/assets/BrandSans.ttf`，再在 `src/frontend/fonts.ts` 声明 descriptor。`src` 相对声明文件解析且必须留在 frontend root 内；配置需为静态对象字面量，不能用请求数据或函数计算。`defineFont` 要求 font family 和实际许可证标识或应用自有许可证引用。编译器输出本地 WOFF2 subset，SSR 根据 manifest 生成 `@font-face`，等价输出会去重。

```ts
// src/frontend/fonts.ts
import { defineFont } from "vextjs/frontend";

export const brandFont = defineFont({
  src: "./assets/BrandSans.ttf",
  family: "Brand Sans",
  weight: 400,
  display: "swap",
  preload: true,
  fallback: "system-ui",
  license: "OFL-1.1",
});
```

将许可证值替换为该字体实际许可。省略 `subset` 时只包含默认可打印 ASCII；中文等字符需显式提供应用需要的 `subset` 字符串，并确保原字体含相应字形。生成 `@font-face` 不会自动把字体应用到元素，仍需在页面或全局 CSS 设置 `font-family: "Brand Sans", system-ui`。

远程 font URL 会被拒绝。本地 media worker 不包含 CDN SDK、远程字体下载器或 bundler plugin 层。

## 验证资源

在应用根目录执行 `npm run build`，核对公开清单与媒体清单中的实际输出，再运行 `npm start -- --port 3000`。访问引用资源的页面，检查图片/字体真实加载、Content-Type、缓存头及条件请求；不要仅凭文件存在判定 URL 正确。媒体示例还需检查尺寸、srcSet、字体字形与预算错误。部署 CDN 后用浏览器检查实际 CDN URL；本地 dry-run 无法代替远程可达性验证。结束后停止服务。
