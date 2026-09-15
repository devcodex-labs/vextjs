import type {
  DependencyKnowledgeEntry,
  KnowledgeExample,
} from "./contracts.js";

const typeTest = "test/unit/mcp/mcp-knowledge-consumers.test.ts";

/** 示例本身作为类型测试输入；不能另写一份相似代码代替检查公开知识。 */
export const DATABASE_KNOWLEDGE_EXAMPLES: KnowledgeExample[] = [
  {
    id: "monsqlize-native-pagination",
    purpose:
      "原生分页与计数；领域类型放入 types/server/services 或 types/server/models，service 保留查询与业务规则。",
    language: "typescript",
    prerequisites: [
      "findPage 的 sync totals 可能使用独立 TTL 缓存，cache: 0 不代表强制实时总数；需要每次编号分页都重新计数时使用原生 findAndCount(query, { skip, limit, sort })，它返回 data/total。",
      "config.database 已启用，posts Model 已通过 Vext loader 注册。",
      "page/limit/after 由请求 schema 校验；示例函数不承担鉴权。",
    ],
    verification: { typeTest },
    filePath: "src/services/posts.ts",
    supportFiles: {
      "src/types/server/models/post.ts": `/** 持久化文档；API 序列化日期时另定义实际 DTO。 */
export interface PostDocument {
  title: string;
  status: "draft" | "published";
  createdAt: Date;
}
`,
    },
    code: `import type { VextApp } from "vextjs";
import type { PostDocument } from "../types/server/models/post.js";

/** 数据库原生分页；请求校验和授权由调用入口完成。 */
export default class PostsService {
  constructor(private readonly app: VextApp) {}

  async list(page: number, limit: number) {
    if (!this.app.db) throw new Error("Posts requires config.database.");
    const posts = this.app.db.model<PostDocument>("posts");
    const result = await posts.findPage({
      query: { status: "published" },
      page,
      limit,
      sort: { createdAt: -1, _id: -1 },
      totals: { mode: "sync" },
    });
    return {
      items: result.items,
      pageInfo: result.pageInfo,
      totals: result.totals,
    };
  }

  async next(after: string, limit: number) {
    if (!this.app.db) throw new Error("Posts requires config.database.");
    return this.app.db.model<PostDocument>("posts").findPage({
      query: { status: "published" },
      after,
      limit,
      sort: { createdAt: -1, _id: -1 },
    });
  }

  async countAndList() {
    if (!this.app.db) throw new Error("Posts requires config.database.");
    const result = await this.app.db
      .model<PostDocument>("posts")
      .findAndCount(
        { status: "published" },
        { limit: 20, sort: { createdAt: -1, _id: -1 } },
      );
    return { items: result.data, total: result.total };
  }
}
`,
  },
  {
    id: "monsqlize-model-definition",
    purpose:
      "Vext 原生模型、唯一索引和连接选择；模型导出交给 loader，不重复 Model.define。",
    language: "typescript",
    prerequisites: [
      "模型文件放入实际 models 自动加载目录；连接名称必须对应 config.database 的池与数据库。",
    ],
    verification: { typeTest },
    filePath: "src/models/post.ts",
    supportFiles: {
      "src/types/server/models/post.ts":
        "export interface PostDocument { slug: string; title: string; }\n",
    },
    code: `import type { VextModelDefinition } from "vextjs";

import type { PostDocument } from "../types/server/models/post.js";

export default {
  collection: "posts",
  key: "Posts",
  schema: { slug: "string!", title: "string!" },
  indexes: [{ key: { slug: 1 }, unique: true }],
  connection: { pool: "primary", database: "content" },
} satisfies VextModelDefinition<PostDocument>;
`,
  },
];

export const MONSQLIZE_KNOWLEDGE: DependencyKnowledgeEntry = {
  id: "K05",
  summary:
    "monSQLize 原生泛型、查询、分页、模型、多库和事务边界；Vext 拥有连接及模型加载生命周期。",
  dependency: {
    packageName: "monsqlize",
    reviewedVersions: ["3.3.0"],
    reviewedOn: "2026-09-15",
    evidence: {
      officialUrls: ["https://github.com/devcodex-labs/monSQLize"],
      installedPackageFiles: [
        "README.md",
        "dist/types/collection.d.ts",
        "dist/types/model.d.ts",
        "dist/cjs/index.cjs",
      ],
    },
    entryPoints: [
      "app.db.model<TDocument>(registeredKey)",
      "app.db.collection(name)",
      "app.db.use(database)",
      "app.db.pool(pool)",
      "VextModelDefinition",
    ],
    prerequisites: [
      "database 可选；只在需要 DB 的模块显式检查 app.db。",
      "先 inspect models/ownership/config 与实际依赖版本；monorepo 共享包声明、sourceExports 和 consumer dependencies 必须匹配。",
    ],
    guidance: [
      "当前 3.3.0 findPage totals 有独立缓存（默认 ttlMs 为 600000 毫秒），sync 表示同步取得 totals，并不保证来自本次 count；失败还可能返回 null/error。需要实时编号分页总数时优先 findAndCount，不手动拉固定条数分页，也不把 count 失败改成 0。",
      "模型数组字段使用 { type: 'array', items: { type: 'string' } } 或 array<string> DSL；当前 schema-dsl 3.0.4 不正确编译 ['string'] 简写。数字/布尔约束在字段级 JSON Schema 表达，请求根仍使用 DSL 字段表。",
      "唯一键冲突经 monSQLize 可能映射为 code='DUPLICATE_KEY'，原始 MongoDB 错误为 11000；按实际 code 和约束归属映射冲突，不匹配任意错误文本或吞掉其他数据库失败。",
      "findPage(options) 只接收一个对象：query、page/limit 或 after/before、sort、projection、totals。返回 items、pageInfo、可选 totals/meta。不要使用 findPage(filter, options)、filter/cursor 错误字段或 result.data。",
      "findAndCount(query, options) 返回 data 和 total；find(query, options) 合法。优先原生 find/findOne/findByIds/findOneById/count/aggregate，禁止为分页读取固定上限数据再内存筛选、计数或 slice。排序需包含唯一稳定字段；超大页、分页上限与游标失效须有真实负例。",
      "model<TDocument>() 原生提供读取结果泛型；不重造 Collection/Repository 接口，不以 as unknown as 或 any 绕开类型。DTO、输入、序列化返回值确有区别时单独定义领域类型；部分写入选项为 unknown，仍需请求 schema、模型 schema 与输入类型。",
      "根模型注册键取实际 collection/key 和 loader 结果；models/<database>/<file>、models/<pool>/<database>/<file> 有连接语义，不能作为任意业务模块目录。显式 connection 覆盖目录推导；共享包与本地模型都交给 Vext loader 处理冲突和回滚。",
      "模型 schema/hooks/index 由原生 ModelDefinition 定义；raw collection 是合法接缝，但须确认是否绕过模型校验/hooks。批量写入、事务、聚合和高级参数按原生签名使用，不用通用 CRUD 包装掩盖语义。",
      "config.database.namespace 与 cursorSecret 在协作进程中保持稳定；启用 requireCursorSecret 时要提供真实游标密钥，不按 PID 随机生成。模型关闭/销毁以 app owner 为边界，共享 models 包不持有全局 live 连接。",
      "config.database.options 仅接受 Vext 明确允许的高级键（如 transaction、sync、findMaxLimit、requireCursorSecret）；type/database/cache/logger/pools/models/cursorSecret 等生命周期或顶层配置键受保护，不能在 options 中覆盖。",
      "单条读写使用数据库过滤条件、ObjectId 验证和原子更新；唯一性由数据库唯一索引兜底，先查后写不能保证并发安全。PATCH 区分未提供、null 和空值，采用 $set/$unset；不能用 create 全量必填 schema 代替 PATCH。",
      "需要事务时使用原生 withTransaction，并把 tx.session 显式传给事务内操作。MongoDB 事务需支持事务的部署；跨 Redis 缓存失效不是数据库事务的一部分。提交后缓存失败应记录/重试，不能声称数据库写入已回滚。",
      "查询 cache、数据库 cache.memory.ttl/cache.redis.ttl 为毫秒。内存缓存和本地锁不能证明跨进程一致性；不要把响应缓存、Job store、限流 store 与数据库缓存混为一个 owner。",
      "mock 数据放 mocks/data 与 mocks/scenarios；种子通过显式 seed 脚本执行。数据库读取失败不能悄悄返回 mock，也不能在 GET 请求初始化数据。",
    ],
    limitations: [
      "MongoDB 为当前稳定适配器；不承诺 MySQL/PostgreSQL 已可用。",
      "模型键字符串、部分写入输入、权限和缓存一致性并非 TypeScript 自动保证。",
      "本知识不是第三方完整手册；高级聚合、向量检索和事务选项按精确版本官方 API 审查后使用。MCP 不连接数据库或执行示例。",
    ],
    examples: DATABASE_KNOWLEDGE_EXAMPLES,
  },
};
