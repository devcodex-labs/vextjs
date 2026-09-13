import { createHash } from "node:crypto";
import { createRequire } from "node:module";

export const VEXT_MCP_SCHEMA_VERSION = 1 as const;

export const VEXT_MCP_TOOL_NAMES = [
  "vext_project_inspect",
  "vext_knowledge_search",
  "vext_capability_check",
  "vext_generate_changes",
  "vext_validate_changes",
  "vext_project_check",
  "vext_runtime_inspect",
] as const;

export type VextMcpToolName = (typeof VEXT_MCP_TOOL_NAMES)[number];

export const VEXT_MCP_RESOURCE_URIS = [
  "vext://catalog/capabilities",
  "vext://catalog/rules",
  "vext://catalog/recipes",
  "vext://catalog/workflows",
  "vext://project/snapshot",
  "vext://project/routes",
  "vext://project/services",
  "vext://project/frontend",
  "vext://project/ownership",
  "vext://project/structure",
  "vext://runtime/snapshot",
] as const;

export type VextMcpResourceUri = (typeof VEXT_MCP_RESOURCE_URIS)[number];

export const VEXT_MCP_PROMPT_NAMES = [
  "create-vext-module",
  "diagnose-vext-project",
  "review-vext-changes",
  "check-vext-production-readiness",
] as const;

export type VextMcpPromptName = (typeof VEXT_MCP_PROMPT_NAMES)[number];

export interface VextMcpCatalogItem {
  id: string;
  kind: "capability" | "rule" | "recipe" | "knowledge" | "workflow";
  title: string;
  summary: string;
  body: string;
  status: "available" | "partial" | "planned";
  sourceRefs: string[];
  relatedIds?: string[];
  limitations?: string[];
}

export const VEXT_MCP_KNOWLEDGE: VextMcpCatalogItem[] = [
  dependencyKnowledge(
    "K01",
    "schema-dsl",
    "schema-dsl",
    "Vext 默认请求/响应校验和 OpenAPI schema 转换的 DSL 引擎。",
    [
      "RouteOptions.validate、Job payload、app.getValidator() 默认走 schema-dsl 适配层。",
      "业务 service 优先使用 app.getValidator()，避免直接 import schema-dsl 绕过全局替换能力。",
      "OpenAPI 转换保留 schema-dsl v3 的干净 JSON Schema 输出，Vext 只补充 description/example/nullable 等文档字段。",
    ],
    [
      "website/docs/zh/guide/validation.md",
      "website/docs/zh/api/route-definition.md",
      "src/lib/openapi/schema-converter.ts",
      "node_modules/schema-dsl/README.md",
    ],
  ),
  dependencyKnowledge(
    "K02",
    "response-cache-kit",
    "response-cache-kit",
    "Vext 响应缓存和 app.cache 控制面的底层框架无关工具包。",
    [
      "RouteOptions.cache 和 config.cache.cacheHub 使用 response-cache-kit/cache-hub 语义。",
      "业务代码通常通过 app.cache 和路由 cache 配置使用，不直接操作底层 Store。",
      "Redis/MultiLevel 场景只清理当前 Vext cache namespace，不清空外部 Redis 全库。",
    ],
    [
      "website/docs/zh/guide/cache.md",
      "website/docs/zh/api/app.md",
      "src/lib/middlewares/route-cache.ts",
      "node_modules/response-cache-kit/README.md",
    ],
  ),
  dependencyKnowledge(
    "K03",
    "flex-rate-limit",
    "flex-rate-limit",
    "Vext 内置全局与路由级限流的默认实现。",
    [
      "config.rateLimit 和 RouteOptions.rateLimit 会进入 Vext 的中间件适配层。",
      "默认内存限流适合单进程或开发验证；多进程/集群需要 Redis 或等价共享 Store。",
      "插件可以替换 limiter 实现，但 keyBy、enabled、message 等 Vext 配置语义仍需保持。",
    ],
    [
      "website/docs/zh/api/config.md",
      "website/docs/zh/api/app.md",
      "src/lib/middlewares/rate-limit.ts",
      "node_modules/flex-rate-limit/README.md",
    ],
  ),
  dependencyKnowledge(
    "K04",
    "esbuild",
    "esbuild",
    "Vext 后端、前端、测试、preload 与服务热重载编译管线使用的构建器。",
    [
      "vext build、dev service 编译、testing services:true 和 preload TS 编译均依赖 esbuild。",
      "后端构建保留模块边界并 external 化包依赖，避免打包改变热重载和运行时身份。",
      "MCP 给出的构建/测试建议应优先走 vext build、vext dev、createTestApp 等框架入口。",
    ],
    [
      "website/docs/zh/guide/build.md",
      "website/docs/zh/guide/testing.md",
      "website/docs/zh/guide/preload.md",
      "node_modules/esbuild/README.md",
    ],
  ),
  dependencyKnowledge(
    "K05",
    "monsqlize",
    "monsqlize",
    "Vext 内置数据库插件、多数据库连接池、Model 自动加载与共享模型能力的运行时依赖。",
    [
      "config.database 启用内置 monsqlize 插件；连接、模型加载和关闭生命周期由 Vext 接管。",
      "本地 models 与 workspace shared model package 都要走 Vext model loader，保持 ownership、rollback 和冲突诊断。",
      "MongoDB 是当前稳定适配器；MySQL/PostgreSQL 不能作为已完成能力承诺。",
    ],
    [
      "website/docs/zh/guide/database.md",
      "website/docs/zh/api/config.md",
      "src/lib/plugins/monsqlize/model-loader.ts",
      "node_modules/monsqlize/README.md",
    ],
  ),
];

export const VEXT_MCP_RECIPES: VextMcpCatalogItem[] = [
  recipe("RCP-01", "api-route", "生成单个 API 路由及请求/响应契约。"),
  recipe("RCP-02", "api-module", "生成一组 API 路由及对应 service/schema。"),
  recipe("RCP-03", "page-route", "生成 SSR/CSR/静态页面路由。"),
  recipe("RCP-04", "page-and-api", "生成页面、API 与客户端调用闭环。"),
  recipe("RCP-05", "service", "生成 service 类、方法与调用边界。"),
  recipe("RCP-06", "model", "生成 MonSQLize model 注册与多库定位。"),
  recipe("RCP-07", "middleware", "生成 handler/factory 中间件。"),
  recipe("RCP-08", "plugin", "生成插件 setup、生命周期和扩展挂载。"),
  recipe("RCP-09", "locale", "生成前后端隔离的多语言消息。"),
  recipe("RCP-10", "test", "生成单元、集成、API 或浏览器测试候选。"),
  recipe("RCP-11", "type-contract", "生成服务端、前端或共享类型契约。"),
  recipe("RCP-12", "utility", "生成工具函数或校验函数。"),
  recipe("RCP-13", "frontend-component", "生成前端组件及样式接入。"),
  recipe("RCP-14", "frontend-layout", "生成页面 layout 并绑定消费者。"),
  recipe("RCP-15", "reusable-schema", "生成可复用 schema 并绑定消费者。"),
  recipe("RCP-16", "mock-scenario", "生成前后端 mock 场景与测试替身。"),
  recipe("RCP-17", "job-handler", "生成 Job 定义、手动/队列/定时执行候选。"),
];

export const VEXT_MCP_WORKFLOWS: VextMcpCatalogItem[] = [
  workflow(
    "WF-01",
    "create-vext-module",
    "inspect → capability → generate ChangeSet → validate directories/identity/overwrite → 宿主应用 → 按 requiredHostSteps 检查/测试/文档。",
  ),
  workflow(
    "WF-02",
    "diagnose-vext-project",
    "事实采集 → 可选运行态 → 宿主复现 → 根因 → 修改 → 回归。",
  ),
  workflow(
    "WF-03",
    "review-vext-changes",
    "基线/候选 → 兼容性/消费者 → 正反证据 → 审查结论。",
  ),
  workflow(
    "WF-04",
    "check-vext-production-readiness",
    "依赖/配置 → 构建身份 → 生产/cluster/资产/缺证据检查。",
  ),
];

export const VEXT_MCP_CAPABILITIES: VextMcpCatalogItem[] = [
  capability(
    "C01",
    "项目身份与固定根",
    "固定服务根、版本、上下文修订和策略摘要。",
  ),
  capability(
    "C02",
    "目录结构与角色发现",
    "发现 routes/services/models/schemas/utils/shared-types/frontend/config/docs/mocks/jobs 等角色目录。",
  ),
  capability(
    "C03",
    "API 路由",
    "识别 defineRoutes 路由、method/path/fullPath 与校验契约。",
  ),
  capability(
    "C04",
    "请求响应 schema",
    "投影 schema-dsl、对象 schema 和 SymbolRef。",
  ),
  capability(
    "C05",
    "Service 与依赖图",
    "识别 service 导出、嵌套 key 与服务依赖边。",
  ),
  capability(
    "C06",
    "Middleware",
    "识别白名单、handler/factory、全局与路由挂载。",
  ),
  capability("C07", "Plugin", "识别插件 setup/onReady/onClose 与 app 扩展。"),
  capability(
    "C08",
    "Models 与多数据库",
    "识别 local/shared model、collection、pool/database、alias 和冲突。",
  ),
  capability(
    "C09",
    "Frontend 页面",
    "识别 pages/layout/document/errors 与路由关联。",
  ),
  capability(
    "C10",
    "静态资源",
    "识别 public/assets、构建产物边界和前后端隔离。",
  ),
  capability("C11", "Locales", "识别按功能模块组织的前后端 locales。"),
  capability(
    "C12",
    "配置层",
    "识别 default/profile/local/provider/CLI 配置来源。",
  ),
  capability(
    "C13",
    "OpenAPI 与 Docs",
    "识别 OpenAPI、Docs 页面和机器可读文档入口。",
  ),
  capability(
    "C14",
    "Mock 数据与场景",
    "识别 mock 数据、测试替身、HTTP/浏览器入口。",
  ),
  capability(
    "C15",
    "测试脚本",
    "识别 unit/integration/e2e/build/typegen 等宿主执行脚本。",
  ),
  capability(
    "C16",
    "构建与 typegen",
    "识别构建位置、类型生成、新鲜度与产物 owner。",
  ),
  capability(
    "C17",
    "Cluster 与重启",
    "识别生产启动、rolling reload 和状态检查能力。",
  ),
  capability(
    "C18",
    "Runtime Bridge",
    "读取项目内受管运行态快照、worker 代次、reload 和事件；运行时写入器仍按后续批次接入。",
    "partial",
  ),
  capability("C19", "缓存", "识别 response-cache-kit 与路由缓存策略。"),
  capability("C20", "限流", "识别 flex-rate-limit 和路由覆盖策略。"),
  capability("C21", "安全与 CSRF", "识别 auth、csrf、安全头和 session 约束。"),
  capability(
    "C22",
    "文件上传与 body parser",
    "识别 multipart、bodyParser 和大小限制。",
  ),
  capability(
    "C23",
    "Monorepo workspace",
    "识别 vext.workspace.json 服务、shared packages，并用于候选目录策略。",
  ),
  capability(
    "C24",
    "共享 contracts/models",
    "识别共享包 sourceExports，并在候选校验中标注 shared package 来源。",
  ),
  capability("C25", "代码注释策略", "按项目语言和用户规范判断注释语言及密度。"),
  capability(
    "C26",
    "变更草稿",
    "为 17 条 Recipe 生成 create-only ChangeSet 候选并绑定项目身份。",
  ),
  capability(
    "C27",
    "候选校验",
    "校验 changeSet/files 的身份、目录策略、已有文件、重复路径、编码和 create-only 边界，并返回文件级解释。",
  ),
  capability(
    "C28",
    "宿主操作流程",
    "按候选目录角色输出启动、重启、测试、构建、部署等宿主流程建议；命令仍由宿主执行。",
  ),
  capability(
    "C29",
    "宿主配置同步",
    "为 Codex/Claude/Cursor/VS Code/Grok 生成宿主 MCP 同步计划；当前可写 JSON/JSONC 宿主配置、TOML 受管块和 launcher，并返回写后回读校验与宿主刷新提示。",
  ),
  capability(
    "C30",
    "Skill/Workflow",
    "提供可选逻辑 Skill 与 Tools-only 工作流等价路径；当前可通过 CLI 导出官方 Skill，并可通过 vext mcp sync --skill 写入项目内宿主 Skill 路径。",
  ),
  capability("C31", "资源与 Prompt", "注册固定 11 Resources 和 4 Prompts。"),
  capability(
    "C32",
    "发布验收矩阵",
    "维护发布前多平台、多宿主、同 tgz 验收证据；当前已接入同包 MCP stdio 安装烟测，真实宿主矩阵仍需发布阶段补齐。",
    "partial",
  ),
  capability(
    "C33",
    "依赖知识",
    "登记 schema-dsl、response-cache-kit、flex-rate-limit、esbuild、monsqlize 的版本与 Vext 使用边界，可通过 knowledge 搜索。",
  ),
  capability(
    "C34",
    "Job",
    "静态识别 Job 定义、scheduler、worker、store、CLI 和文档入口。",
  ),
];

export const VEXT_MCP_RULES: VextMcpCatalogItem[] = [
  rule(
    "R01",
    "fixed-root",
    "MCP 进程绑定单个项目根，Tool 不接受 root/cwd/shell 参数。",
  ),
  rule(
    "R02",
    "host-executes",
    "启动、重启、测试、构建、应用变更由 AI 宿主执行，MCP 只提供流程和候选。",
  ),
  rule(
    "R03",
    "no-arbitrary-file-resource",
    "Resources 不开放任意 file URI 或路径模板。",
  ),
  rule(
    "R04",
    "baseline-required",
    "生成/校验可携带 expectedIdentity；过期项目身份返回 VEXT_CONTEXT_STALE，ChangeSet baseIdentity 不匹配会 invalid。",
  ),
  rule(
    "R05",
    "default-not-forced",
    "默认目录是建议，不强制创建空目录；候选目录从项目 section 与 workspace 派生，用户项目规范优先。",
  ),
  rule(
    "R06",
    "managed-mcp-update",
    "项目需求、API、配置、依赖、目录、脚本、测试/文档流程变化时必须判定 MCP 知识、Recipe、Resources、Prompts、校验和报告是否同步。",
  ),
];

export function buildMcpCatalog() {
  const items = [
    ...VEXT_MCP_CAPABILITIES,
    ...VEXT_MCP_RULES,
    ...VEXT_MCP_KNOWLEDGE,
    ...VEXT_MCP_RECIPES,
    ...VEXT_MCP_WORKFLOWS,
  ];
  const digest = createHash("sha256")
    .update(JSON.stringify(items))
    .digest("hex");
  return { schemaVersion: VEXT_MCP_SCHEMA_VERSION, digest, items };
}

export function searchMcpCatalog(input: {
  query?: string;
  ids?: string[];
  kinds?: string[];
  domain?: string;
  limit?: number;
}) {
  const catalog = buildMcpCatalog();
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
  const kinds = new Set(input.kinds ?? []);
  const unknownIds: string[] = [];
  let matches: (VextMcpCatalogItem & { score: number })[];
  if (input.ids?.length) {
    matches = input.ids.flatMap((id) => {
      const item = catalog.items.find((entry) => entry.id === id);
      if (!item) {
        unknownIds.push(id);
        return [];
      }
      return [{ ...item, score: 100 }];
    });
  } else {
    const query = (input.query ?? "").trim().toLowerCase();
    matches = catalog.items
      .filter((item) => (kinds.size ? kinds.has(item.kind) : true))
      .filter((item) => (input.domain ? item.id === input.domain : true))
      .map((item) => ({ ...item, score: scoreCatalogItem(item, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }
  return {
    catalogDigest: catalog.digest,
    matches: matches.slice(0, limit),
    unknownIds,
  };
}

function scoreCatalogItem(item: VextMcpCatalogItem, query: string): number {
  if (!query) return 1;
  const haystack =
    `${item.id} ${item.title} ${item.summary} ${item.body}`.toLowerCase();
  if (item.id.toLowerCase() === query) return 100;
  if (haystack.includes(query)) return 20 + query.length;
  return query
    .split(/\s+/)
    .filter(Boolean)
    .reduce((score, token) => score + (haystack.includes(token) ? 3 : 0), 0);
}

function capability(
  id: string,
  title: string,
  summary: string,
  status: VextMcpCatalogItem["status"] = "available",
): VextMcpCatalogItem {
  return {
    id,
    kind: "capability",
    title,
    summary,
    body: `${title}：${summary}`,
    status,
    sourceRefs: [
      "requirements/02-完整技术方案.md",
      "requirements/06-协议配置与配方合同.md",
    ],
  };
}

function rule(id: string, title: string, summary: string): VextMcpCatalogItem {
  return {
    id,
    kind: "rule",
    title,
    summary,
    body: `${title}：${summary}`,
    status: "available",
    sourceRefs: ["requirements/06-协议配置与配方合同.md"],
  };
}

function dependencyKnowledge(
  id: string,
  title: string,
  packageName: string,
  summary: string,
  guidance: string[],
  sourceRefs: string[],
): VextMcpCatalogItem {
  const version = dependencyVersion(packageName);
  return {
    id,
    kind: "knowledge",
    title,
    summary: `${summary} 当前依赖版本：${version}。`,
    body: `${title}（${version}）：${summary}\n${guidance
      .map((item) => `- ${item}`)
      .join("\n")}`,
    status: "available",
    sourceRefs,
  };
}

function recipe(
  id: string,
  title: string,
  summary: string,
  status: VextMcpCatalogItem["status"] = "available",
): VextMcpCatalogItem {
  return {
    id,
    kind: "recipe",
    title,
    summary,
    body: `${title} Recipe：${summary}`,
    status,
    sourceRefs: ["requirements/02-完整技术方案.md#Recipe 矩阵"],
  };
}

function dependencyVersion(packageName: string): string {
  const versions = readPackageDependencyVersions();
  return versions[packageName] ?? "unknown";
}

function readPackageDependencyVersions(): Record<string, string> {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  } catch {
    return {};
  }
}

function workflow(
  id: string,
  title: string,
  summary: string,
): VextMcpCatalogItem {
  return {
    id,
    kind: "workflow",
    title,
    summary,
    body: `${title} 工作流：${summary}`,
    status: "available",
    sourceRefs: [
      "requirements/02-完整技术方案.md#Resources、Prompts 和缺能力宿主",
    ],
  };
}
