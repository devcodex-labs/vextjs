# 构建与发布

`vext build` 会在一个命令中编译服务端产物和前端产物。本页给出生产交付路径；字段级说明见[前端配置](./configuration)，缓存和媒体行为见[静态资源与 CDN](./static-assets-and-cdn)。

## 先验证同源交付

从已启用前端的[全栈项目](./getting-started)开始，在应用根目录执行 `npm run build`，成功后运行 `npm start -- --port 3000`。访问已有 SSR 路由，确认原始 HTML 有正文、浏览器交互正常、实际引用的 JS/CSS 返回 200；结束后停止服务。应用脚本调用本地安装的 CLI，后文的 `vext` 命令也应在能解析该本地 CLI 的环境中执行。

先完成这条路径，再按需要配置 CDN 与上传。示例域名不是可用 CDN，必须替换成实际可提供资源的地址。

## 输出

生成源码和最终前端产物通过同一事务提交：浏览器与服务端编译、媒体、静态页面、SEO、部署清单及预算均先使用本次候选，全部成功后才替换旧代。失败保留旧文件，未登记文件保留且不自动公开；进程中断后由下一次持有项目写入权的构建恢复。每个文件分别原子替换，完整性判断以构建完成回执为准。上传发生在成功构建之后，上传失败不会回滚已提交的本地产物；详见[构建流程](../guide/build)。

启用 frontend 后，生产输出包含：

```text
dist/
  config/ routes/ services/ ...     # 服务端文件保持源码目录映射
  client/
    index.html
    assets/                         # 浏览器 JS、CSS 与 import 型资源
    manifest.json
    public-manifest.json            # HTTP 静态服务与上传共同使用的公开文件清单
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

上图是默认目录。`vext build --outdir build` 会将后端写入 `build/`，前端未指定 `frontend.outDir` 时写入 `build/client/`；`vext start` 使用成功构建记录选择同一目录，也可用 `--outdir` 显式选择。后端保持源码目录映射，不固定生成顶层 `dist/server/`。SSR renderer 默认位于所选前端输出内，由 `render-manifest.json` 与 client assets 一起校验。

当对应功能没有声明输入时，`messages-manifest.json`、`media-manifest.json` 与 `static-manifest.json` 可能为空，但仍是有效构建证据。关闭 `frontend.build.diagnostics.sizeReport` 时会故意不生成 `size-report.json`。Source map 同样取决于配置：浏览器生产构建默认不生成，后端 CLI 编译默认生成外部 source map。

`vext start` 只提供 `public-manifest.json` 登记的静态文件，并使用 `render-manifest.json` 做 SSR。公开清单由 public 文件、浏览器构建、媒体、静态页面及 SEO 的实际产物生成；服务端 renderer、其 source map 和内部元数据不公开，自定义 `build.server.outFile` 也遵守此边界。构建后手动放入 outDir 的文件不会自动公开。

生产模式会在 listen 前检查 `index.html`、`render-manifest.json`、route asset metadata、其引用的 server renderer 和公开文件清单；任一缺失或无效都会失败，需重新执行 `vext build`。上传入口同样校验公开清单，再应用 upload include/exclude，不会仅凭传入的 deploy manifest 上传私有文件。

## 选择交付形态

成功构建记录同时保存后端构建身份、profile、前端公开清单的 `buildId` 与字节摘要；只有公开清单和渲染清单都属于受管的同一代次，才提交成功位置。自动生成的部署清单携带同一前端 `buildId`，上传前校验代次与逐资源内容。手工清单未提供 `buildId` 时只能证明资源字节一致，不能证明构建代次。

`frontend.outDir` 和后端 `--outdir` 可显式指定服务目录外的独立输出，元数据使用规范化绝对路径；普通项目仍保存相对路径。框架拒绝与源码、其他服务或运行态重叠的目标，并保留产物文件名大小写。移动外部输出时需要重新构建记录；部署后的 Node 依赖必须能从实际输出目录按 Node 规则解析，框架不会把原开发机的依赖绝对路径写进生产包。

| 需求                                  | 默认值 / 配置                           | 会发生什么                                                     | 如何验证                                |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------- | --------------------------------------- |
| 一个 Node 服务同时提供 HTML 和 assets | 不设置 `assetBaseUrl`                   | `vext start` 同源提供公开清单内的文件                          | 从应用 origin 请求页面和一个 hash asset |
| CDN 提供 immutable assets             | 设置绝对 `frontend.deploy.assetBaseUrl` | 生成的 JS/CSS URL 指向 CDN；HTML 与 SSR 仍由 Node runtime 负责 | 检查生成 HTML，再通过 CDN URL 请求资源  |
| 增量上传 assets                       | `frontend.deploy.upload.enabled: true`  | 由 `deploy-manifest.json` 按内容 hash 驱动上传                 | 先执行 dry-run，再执行真实上传          |

第一行就是默认路径：可工作的全栈服务不需要 CDN，也不需要 upload adapter。

## 构建后启动

```bash
vext build
vext start
```

这是完整的同源生产路径。build 生成后端 JavaScript 与前端 closure；start 在接受流量前会校验该 closure。

完成下方 upload 配置后，构建并上传静态资源：

```bash
vext build --upload-assets
```

或对已有成功构建单独执行上传（同样需要可解析的 upload 目标）：

```bash
vext deploy assets --dry-run
vext deploy assets
```

`vext deploy assets` 只接受 option 参数，不接受额外位置参数。需要取值的参数必须提供非 option 值；例如 `--manifest --dry-run`、`--target-dir --dry-run` 会直接失败，而不是把后一个 flag 当作路径。

独立上传与 `vext start` 读取同一成功构建位置，使用其中记录的 profile；`--outdir`、`--config` 可显式选择。默认 manifest 来自解析后的 `frontend.outDir`，不会固定猜测 `dist/client`。`--json` 返回 `{ ok: true, result }`；失败返回 `{ ok: false, error, result? }`，上传开始后的失败保留逐资源结果。

## 程序化上传集成

普通发布应使用 `vext deploy assets`。如果工具链自己负责编排发布，可以从 `vextjs/frontend` 导入 `deployFrontendAssets`；它使用与 CLI 相同的 deploy manifest 和 upload plan，并需要 resolved frontend configuration 与 manifest path。只有工具链自己拥有云厂商集成时，才传入自定义 upload adapter。

## CDN 与增量上传

`deploy-manifest.json` 记录可上传静态资源：

- JS 和 CSS assets
- import 的图片、字体、媒体文件
- 复制过来的 `public/**` 文件
- content type
- sha256
- 可用资源的 SRI
- upload key 和 public URL

顶层 `index.html` 模板不进入上传集合，动态 SSR 仍由 Node runtime 生成。但已登记为公开产物的嵌套静态 HTML（例如 `posts/hello/index.html`）和对应数据文件可以进入上传计划，不能把这一规则理解为“所有 HTML 都不上传”。Source map 默认被 upload exclude 排除；最终集合应以本次 dry-run 为准。

## 安全发布顺序

1. 只有确定由 CDN 服务浏览器资源时，才设置绝对 `frontend.deploy.assetBaseUrl`。
2. 把 `frontend.deploy.upload.stateFile` 放在 `frontend.outDir` 外，避免 build 清理时删除上传历史。
3. 只构建一次：`vext build`。
4. 先审阅准确上传集合：`vext deploy assets --dry-run`。
5. 执行 `vext deploy assets`，再部署匹配同一版本的 `dist/` Node runtime。不要用新 CDN manifest 搭配旧 server renderer。
6. 请求一个 SSR 页面和一个 hash asset，确认生成的资源 URL、缓存头与（如已开启）SRI 来自同一次发布。

内置 adapter 只有 `filesystem` 与 `mock`。`filesystem` 适合生成 staging deploy tree，但不是隐藏的 CDN 集成。云厂商需要显式实现 custom upload adapter；该路径不会安装或假定 bundler/cloud plugin ecosystem。

## 增量上传

上传 state 使用 `schemaVersion: 2`，默认路径仍为 `.vext/deploy/frontend-assets-state.json`。每个目标单独保存已确认成功的 sha256 与字节数；同一目标未变化的资源才跳过。目标身份包括服务真实根、profile、adapter 类型、实际存储身份和 prefix；filesystem 使用目标真实路径。改变目标或 profile 会重新上传；只改变公开 URL 不代表更换存储。

自定义 adapter 可以提供稳定字符串 `targetIdentity`，例如账号与 bucket 的组合，不包含凭据。未提供身份时仍可上传，但不跨运行跳过。`upload(input)` 仅在远端确认成功后返回 `{ uploaded: true }`，并可消费 `input.signal`；返回 false 或抛错会标为 `unconfirmed`。

`mock` 是保留的模拟 adapter 名称，写入独立模拟分区，结果报告 `simulated` 而不计入 `uploaded`。`dry-run` 不调用 adapter，不写目标或 state。状态格式未知会明确报错并保留原文件，不猜测历史状态对应的目标。

同一 state 或已知存储目标只允许一个 writer。部分失败或取消时，已确认成功项仍会原子保存，待执行项不会冒充成功；重试会重新处理未确认项。远端上传没有整体回滚承诺。程序化入口抛出的 `FrontendDeployError.result` 包含逐资源结果；状态被外部改动时保留外部文件并报冲突，依据结果核对远端。

同一已知存储命名空间的不同 prefix 也串行，防止父子 prefix 相互覆盖；这是本机 writer 协调，不是跨机器分布式锁。状态文件读取上限为 64 MiB，超限/不可验证文件报错并保留原字节。`--json` 的参数错误和执行错误都通过单行 JSON 报告，退出码非零。

`stateFile` 应放在 frontend outDir 外，避免与构建产物的所有权和清理范围冲突；未登记文件保留不等于推荐把部署状态混入产物目录。

## 配置示例

```ts
export default {
  frontend: {
    enabled: true,
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
  },
};
```

`assetBaseUrl` 必须是绝对 URL。`publicBaseUrl` 是 upload plan 报告的公开地址，`targetDir` 只是内置 filesystem adapter 使用的本地目标目录。只有默认的整份 manifest 上传不适用时，才增加 `include`、`exclude` 与 `concurrency`。

将配置合并进 `src/config/default.ts` 并保留应用其他设置。本例只把文件写到本地 staging tree；你需要自行把目标目录部署到真实 CDN 并保持 URL/key 对应。dry-run 通过只能证明当前本地产物和上传计划可用，不能证明远程资源已经存在。相关缓存头、媒体与跨源设置见[静态资源与 CDN](./static-assets-and-cdn)。
