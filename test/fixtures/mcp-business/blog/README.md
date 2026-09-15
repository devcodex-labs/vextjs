# MCP 博客业务验收样例

这个目录是框架测试夹具，不是用户的 `vextjs-mcp-verify` 服务。测试宿主用本地 CLI 创建临时项目，调用真实 MCP 生成并校验 model、service、API、mock 和 locale 候选，再集成本目录的业务代码。模型与 mock 数据由测试生成，因此不能直接在此目录运行应用。

## 目录与调用

```text
src/
  config/default.ts                 # 宿主注入：唯一数据库、随机管理 token、本地端口
  models/blog-post.ts               # MCP model：schema、唯一索引、自动时间戳
  services/blog.ts                  # 原生 model 调用与业务编排
  schemas/blog.ts                   # 请求字段表与响应 JSON Schema
  validators/blog.ts                # 严格 JSON 类型、字段白名单、业务校验
  middlewares/blog-auth.ts          # 所有管理 API 的鉴权入口
  middlewares/blog-json.ts          # 在框架 coercion 前检查严格 JSON 类型
  utils/server/blog.ts              # 可复用纯查询条件、DTO、slug、原生错误判断
  types/shared/blog.ts              # HTTP DTO，不包含数据库连接或查询接口
  types/server/models/blog-post.ts  # MCP 生成的持久化文档类型
  types/server/services/blog.ts     # 服务用例的私有输入边界
  locales/blog/errors/             # 后端独立中英文字典
  routes/index.ts                  # 页面入口：服务读取 → res.render
  routes/api/blog.ts               # 公开 API：仅已发布文章
  routes/api/admin/blog.ts         # 管理 API：鉴权、no-store、PATCH
  frontend/
    pages/blog/                   # 列表、详情、匿名管理页
    components/                   # 封面回退、随鉴权卸载的编辑面板
    hooks/use-blog-admin.ts        # 请求状态、重复提交与过期响应控制
    lib/blog-api.ts                # HTTP 请求和既有存储清理
    types/blog.ts                 # 前端页面与语言类型
    locales/blog/admin/            # 按功能/子功能组织的 UI 文案
public/blog-cover.svg              # 原样公开的静态资源
mocks/data/blog.ts                 # MCP 生成的无副作用演示数据
mocks/scenarios/blog.ts            # 空列表/发布/草稿场景
scripts/seeds/blog.ts              # 显式、幂等、可并发的数据库 seed
```

这些是默认归属。用户规范或已有目录可以覆盖 MCP 默认；服务契约目录是 `types/server/services`，`server` 区分服务端边界，`services` 区分用例契约。路由负责 HTTP 边界，service 直接调用 monSQLize；不复制其查询接口，不手工加载固定数量后分页。只有真实复用的纯方法才放 utils，局部业务编排可以保留私有方法。

## 配置与业务约定

- 测试需要已有 MongoDB；`VEXT_TEST_MONGODB_URI` 可指定目标，默认本地 27017。每轮使用唯一 `vext_mcp_<UUID>` 数据库并在结束后定向删除。不会清空已有数据库。
- 管理 token 由宿主生成并放在该临时项目的配置中。公开页面不携带 token，管理页初始不读取草稿。管理 API 使用 `Authorization: Bearer ...`，未配置返回 503，凭据错误返回 401。
- Redis 不是这个博客场景的前置条件。响应缓存使用当前内存实现，TTL 为 **300 毫秒**。公开内容最多短暂陈旧；不承诺多节点撤稿即时强一致。
- 请求 `validate` 使用 DSL 字段表；单个字段可以使用 JSON Schema。完整根 JSON Schema 用在响应 schema。JSON boolean、只读字段和数组元素在校验前置中间件检查，避免 coercion 接受错误业务类型。
- 编号分页使用原生 `findAndCount`；公开列表按发布时间和唯一 `_id` 补充排序，管理列表按更新时间排序。`findPage` 的同步 totals 可有独立缓存，不能将 `cache: 0` 当作强制刷新 totals。
- POST 缺省保存为草稿；PATCH 未提供的字段保留，空更新拒绝。唯一冲突返回 409，不存在返回 404。数据库成功但缓存失效失败时返回 `cacheRefresh: pending`，允许管理 purge 重试。
- GET 不执行 seed。显式 seed 使用 `$setOnInsert` 和唯一索引，重复执行或并发执行不会覆盖已有编辑。前端 mock 与数据库 seed 不自动启动。
- UI 文案来自前端字典；领域错误来自后端字典。UTC 日期保持 SSR 与客户端一致。退出和 401 清除 token、旧存储键、数据和编辑状态。

## 验证命令与证据

在 **vextjs 仓库根目录**、现有依赖已准备好时运行：

```sh
node node_modules/vitest/vitest.mjs run test/integration/mcp-business-blog.test.ts --maxWorkers=1
```

浏览器验收还需把 `VEXT_PLAYWRIGHT_MODULE` 指向已有 Playwright 的入口文件，可用 `VEXT_BROWSER_EXECUTABLE` 指定已安装 Chrome。脚本不安装包或浏览器。未指定浏览器模块时该用例明确显示 skipped，不能算浏览器验收通过。`VEXT_MCP_BUSINESS_EVIDENCE` 可指定 JSON 报告路径，记录 MCP 调用、候选、手工集成、命令与清理。

宿主执行链为：CLI `create --skip-install` → 本地依赖链接 → MCP 检查/生成/严格校验 → 业务集成 → CLI `build --typecheck` → 原生 HTTP/MongoDB/SSR → 浏览器。生成的 API client 在构建后用独立类型和运行探针验证，不从源码导入尚未生成的文件形成构建循环。

业务覆盖包括 20 个并发空库请求、幂等 seed、330 条数据分页、草稿隔离、严格输入、PATCH/OpenAPI、唯一索引与时间戳、缓存提交状态/重试/过期、页面导航、语言与图片回退、鉴权与提交状态。测试中的类型检查和 API 契约探针不是“业务单元测试全通过”的替代声明。

如果保留临时消费者做人工调试，可在其根目录使用 `node node_modules/vextjs/dist/cli/index.js dev`、`build --typecheck` 或 `start`；以该版本 CLI 帮助为准。显式 seed 先由宿主编译到 `.vext/scripts/blog-seed.mjs`，然后 `node .vext/scripts/blog-seed.mjs`。不要在源码夹具目录执行这些命令。

MCP 是否被使用要检查实际项目 root、加载实现身份、宿主启用/连接情况及本任务真实 Tool 调用。客户端重连后重新核实，不能以配置文件存在或“已安装 MCP”代替调用证据。

每轮验证停止自己启动的 HTTP listener，核验端口释放，关闭浏览器和数据库客户端，并删除自己的临时链接项目及唯一测试数据库。失败也执行清理；不停止用户已有 MongoDB/Redis，不打包安装，也不改用户验证服务。
