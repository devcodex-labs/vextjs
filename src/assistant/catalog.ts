import { createHash } from "node:crypto";
import { catalogDomains } from "./catalog-domains.js";
import {
  normalizeAnalysisDomain,
  type AnalysisDomain,
} from "../tooling/diagnostics/contracts.js";
import { VEXT_RECIPE_DEFINITIONS } from "./recipe-registry.js";
import { createRequire } from "node:module";
import { DEPENDENCY_KNOWLEDGE } from "./knowledge/index.js";
import {
  knowledgeApplicability,
  type DependencyKnowledge,
  type DependencyKnowledgeEntry,
} from "./knowledge/contracts.js";
import type { ProjectDependencyFact } from "../tooling/project-index/dependencies.js";

export const VEXT_MCP_SCHEMA_VERSION = 2 as const;

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
  domains?: AnalysisDomain[];
  dependency?: DependencyKnowledge & {
    declaredRange: string | null;
    applicability: ReturnType<typeof knowledgeApplicability>;
  };
}

export const VEXT_MCP_KNOWLEDGE: VextMcpCatalogItem[] =
  DEPENDENCY_KNOWLEDGE.map(dependencyKnowledge);

export const VEXT_MCP_RECIPES: VextMcpCatalogItem[] =
  VEXT_RECIPE_DEFINITIONS.map((definition) => ({
    id: definition.id,
    domains: catalogDomains(definition.id),
    kind: "recipe",
    title: definition.name,
    summary: definition.summary,
    body: `${definition.summary}\nOptions schema: ${JSON.stringify(definition.optionsSchema)}\nProduces create-only candidates. Scaffold and prerequisites are explicit; missing business inputs return incomplete. The host applies and runs validation.`,
    status: "available",
    sourceRefs: ["vext://catalog/recipes"],
  }));

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
    "读取框架运行时写入的项目内受管快照、worker 代次、reload 和事件。",
  ),
  capability("C19", "缓存", "识别 response-cache-kit 与路由缓存策略。"),
  capability(
    "C20",
    "限流",
    "识别 flex-rate-limit、内置 memory/redis store 和路由覆盖策略。",
  ),
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
    "校验 changeSet/files 的身份、目录策略、已有文件、重复路径、编码、create-only 边界和生成内容质量，并返回文件级解释。",
  ),
  capability(
    "C28",
    "宿主操作流程",
    "按项目静态诊断和候选目录角色输出启动、重启、测试、构建、部署等宿主流程建议；命令仍由宿主执行。",
  ),
  capability(
    "C29",
    "宿主配置同步",
    "为 Codex/Claude/Cursor/VS Code/Grok 生成宿主 MCP 同步计划；当前可写 Codex 用户级配置、项目内 JSON/JSONC 宿主配置、TOML 受管块和 launcher，并返回写后回读校验与宿主刷新提示。",
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
    "登记 schema-dsl、response-cache-kit、cache-hub、flex-rate-limit、esbuild、monsqlize、croner、ioredis、MCP SDK、React/ReactDOM 和 Oxc 的知识审查版本、实际安装适用性与 Vext 使用边界，可通过 knowledge 搜索。",
  ),
  capability(
    "C34",
    "Job",
    "静态识别 Job 定义、scheduler、worker、memory/file/redis/auto store、run lease、调度 payload 边界、owner 终态完成规则、CLI 和文档入口。",
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
  ].map((item) => ({ ...item, domains: catalogDomains(item.id) }));
  const digest = createHash("sha256")
    .update(JSON.stringify(items))
    .digest("hex");
  return { schemaVersion: VEXT_MCP_SCHEMA_VERSION, digest, items };
}

export function searchMcpCatalog(
  input: {
    query?: string;
    ids?: string[];
    kinds?: string[];
    domain?: string;
    locale?: "en" | "zh";
    limit?: number;
  },
  dependencies?: readonly ProjectDependencyFact[],
) {
  const catalog = buildMcpCatalog();
  const domain = normalizeAnalysisDomain(input.domain);
  if (!domain) throw new Error(`Unknown knowledge domain: ${input.domain}`);
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
      .map((item) => ({ ...item, score: scoreCatalogItem(item, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }
  matches = matches.filter(
    (item) =>
      (!kinds.size || kinds.has(item.kind)) &&
      (domain === "all" || catalogDomains(item.id).includes(domain)),
  );
  const locale = input.locale ?? "zh";
  return {
    catalogDigest: catalog.digest,
    domain,
    localization: {
      requested: locale,
      status: "partial",
      contentLanguage: "mixed",
      notice:
        locale === "zh"
          ? "检索正文保留随包的原始中英文与 API 示例；未提供逐条完整翻译，宿主可按用户语言解释，不能改写契约。"
          : "Entries preserve packaged Chinese/English prose and API examples. Full per-entry translation is unavailable; the host may explain them in the requested language without changing contracts.",
    },
    matches: matches.slice(0, limit).map((item) =>
      item.dependency
        ? {
            ...item,
            dependency: {
              ...item.dependency,
              applicability: knowledgeApplicability(
                item.dependency,
                dependencies,
              ),
            },
          }
        : item,
    ),
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
    domains: catalogDomains(id),
    kind: "capability",
    title,
    summary,
    body: `${title}：${summary}`,
    status,
    sourceRefs: ["vext://catalog/capabilities"],
  };
}

function rule(id: string, title: string, summary: string): VextMcpCatalogItem {
  return {
    id,
    domains: catalogDomains(id),
    kind: "rule",
    title,
    summary,
    body: `${title}：${summary}`,
    status: "available",
    sourceRefs: ["vext://catalog/rules"],
  };
}

function dependencyKnowledge(
  entry: DependencyKnowledgeEntry,
): VextMcpCatalogItem {
  const knowledge = entry.dependency;
  const declaredRange =
    readPackageDependencyVersions()[knowledge.packageName] ?? null;
  return {
    id: entry.id,
    domains: catalogDomains(entry.id),
    kind: "knowledge",
    title: knowledge.packageName,
    summary: `${entry.summary} 知识审查版本：${knowledge.reviewedVersions.join(", ")}；框架声明范围：${declaredRange ?? "unknown"}。`,
    body: [
      entry.summary,
      ...knowledge.guidance,
      ...knowledge.examples.map(
        (example) => `${example.purpose}\n${example.code}`,
      ),
    ].join("\n"),
    status: "available",
    sourceRefs: knowledge.evidence.officialUrls,
    limitations: knowledge.limitations,
    dependency: {
      ...knowledge,
      declaredRange,
      applicability: knowledgeApplicability(knowledge),
    },
  };
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
    domains: catalogDomains(id),
    kind: "workflow",
    title,
    summary,
    body: `${title} 工作流：${summary}`,
    status: "available",
    sourceRefs: ["vext://catalog/workflows"],
  };
}
