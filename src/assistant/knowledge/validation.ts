import type { KnowledgeExample } from "./contracts.js";

/** 按 Vext 的公开入口消费依赖；第三方配置留在对应模块的 owner 边界。 */
export const VALIDATION_KNOWLEDGE_EXAMPLES: Record<string, KnowledgeExample[]> =
  {
    K01: [
      {
        id: "vext-service-validator",
        purpose:
          "service 的领域校验通过当前 app validator，不直接导入 schema-dsl。",
        language: "typescript",
        filePath: "src/services/labels.ts",
        prerequisites: [
          "默认 validate.body/query/param 和 app.getValidator().compile 接收 DSL 字段表；不能把完整 { type: 'object', properties, required } 当成字段表。必填使用字段名/DSL 的 ! 标记。responses 的 JSON Schema 是另一入口；自定义 validator 需真实消费验证。",
          "默认请求校验允许类型转换；严格 JSON boolean/null 和拒绝额外字段应在前置中间件/validators 明确检查，不能改变整个应用的 query 转换行为。",
          "HTTP 输入优先在 RouteOptions.validate 校验；这里演示其他入口复用的领域校验，错误应由项目错误策略映射。",
        ],
        verification: {
          typeTest: "test/unit/mcp/mcp-knowledge-consumers.test.ts",
        },
        code: `import type { VextApp } from "vextjs";

/** 复用应用当前的 validator，保留插件替换能力。 */
export default class LabelsService {
  constructor(private readonly app: VextApp) {}

  validate(input: unknown) {
    const result = this.app.getValidator().compile({ label: "string:1-100!" })(
      input,
    );
    if (!result.valid) throw new Error("Invalid label input");
    return result.data;
  }
}
`,
      },
    ],
    K06: [
      {
        id: "vext-cache-session-adapter",
        purpose:
          "借用 cacheLike 创建 session store；连接由注入者关闭，TTL 转换交给现有 adapter。",
        language: "typescript",
        filePath: "src/utils/server/session-store.ts",
        prerequisites: [
          "cache 由已有插件提供（可用 cache-hub Redis adapter）；prefix 按应用/环境固定，各协作进程一致。",
          "将返回 store 交给实际 session 配置；本示例不建立连接。",
        ],
        verification: {
          typeTest: "test/unit/mcp/mcp-knowledge-consumers.test.ts",
        },
        code: `import { createCacheSessionStore, type VextCacheLike } from "vextjs";

/** cache 为借用资源；不要把同一个客户端的 close 分配给多个消费者。 */
export function createSessionStore(cache: VextCacheLike, prefix: string) {
  return createCacheSessionStore(cache, { prefix });
}
`,
      },
    ],
  };
