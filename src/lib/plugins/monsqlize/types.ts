/**
 * MonSQLize 内置插件类型定义
 *
 * 定义 MonSQLizeConnection（连接对象）和 MonSQLizeDatabaseConfig（数据库配置）。
 * 通过 declare module 'vextjs' 扩展 VextApp 和 VextConfig 接口，
 * 使用户在 app.db / app.monsqlize / app.config.database 上获得完整类型提示。
 *
 * @module lib/plugins/monsqlize/types
 * @see 13-monsqlize-plugin.md §2.1（类型扩展）
 */

// ── 扩展 VextApp / VextConfig ───────────────────────────────
declare module "../../../types/app.js" {
  interface VextApp {
    /** MonSQLize 连接对象（已连接，提供 collection / db / model 快捷方法） */
    db?: MonSQLizeConnection;

    /**
     * 原始 MonSQLize 实例
     * 用于高级场景（事务、底层操作、事件监听等）
     */
    monsqlize?: import("monsqlize").MonSQLize;
  }

  interface VextConfig {
    /** MonSQLize 数据库配置 */
    database?: MonSQLizeDatabaseConfig;
  }
}

// ── 连接对象（connect() 返回值的增强版）─────────────────────

/**
 * MonSQLize 连接对象
 *
 * 由插件在 setup 阶段创建并挂载到 app.db。
 * 封装 MonSQLize 实例的常用方法，提供简洁的 API。
 */
export interface MonSQLizeConnection {
  /** 获取集合操作对象 */
  collection: (
    name: string,
  ) => ReturnType<import("monsqlize").MonSQLize["collection"]>;

  /** 获取数据库实例（跨库查询） */
  db: (name: string) => { collection: (name: string) => unknown };

  /** 获取 Model 操作对象（需先定义 Model） */
  model: (name: string) => ReturnType<import("monsqlize").MonSQLize["model"]>;

  /** 原始 MongoDB Client（事务等高级场景） */
  readonly client: import("mongodb").MongoClient;
}

// ── 配置类型 ────────────────────────────────────────────────

/**
 * MonSQLize 数据库配置
 *
 * 用户在 src/config/default.ts 中通过 database 字段配置。
 * 插件在 setup 阶段读取此配置创建 MonSQLize 实例。
 */
export interface MonSQLizeDatabaseConfig {
  /**
   * MongoDB 连接类型
   * @default 'url'
   */
  type?: "url" | "replica" | "srv";

  /**
   * 连接配置
   * - type='url' 时：{ url: string }
   * - type='replica' 时：{ hosts: string[], replicaSet: string }
   * - type='srv' 时：{ host: string }
   */
  config: {
    url?: string;
    host?: string;
    hosts?: string[];
    port?: number;
    database?: string;
    replicaSet?: string;
    username?: string;
    password?: string;
    authSource?: string;
    options?: Record<string, unknown>;
  };

  /**
   * 缓存配置
   * L1 = 内存 LRU，L2 = Redis（可选）
   */
  cache?: {
    /** L1 内存缓存（默认开启） */
    memory?: {
      enabled?: boolean;
      /** 最大缓存条数（默认 1000） */
      maxSize?: number;
      /** 默认 TTL 秒数（默认 300） */
      ttl?: number;
    };
    /** L2 Redis 缓存（可选） */
    redis?: {
      enabled?: boolean;
      url?: string;
      /** 缓存 key 前缀 */
      prefix?: string;
      /** 默认 TTL 秒数 */
      ttl?: number;
    };
  };

  /**
   * 多连接池配置
   * 微服务场景中用于读写分离或多库访问
   */
  pools?: Array<{
    name: string;
    config: MonSQLizeDatabaseConfig["config"];
    options?: Record<string, unknown>;
  }>;

  /**
   * 连接池选择策略
   * @default 'auto'
   */
  poolStrategy?: "auto" | "round-robin" | "random" | "least-connections";

  /**
   * 全局查询超时（毫秒）
   * @default 2000
   */
  maxTimeMS?: number;

  /**
   * find 默认返回条数上限
   * @default 10
   */
  findLimit?: number;

  /**
   * 分页最大 limit
   * @default 500
   */
  findPageMaxLimit?: number;

  /**
   * 慢查询阈值（毫秒，-1 禁用）
   * @default 500
   */
  slowQueryMs?: number;

  /**
   * 慢查询持久化存储配置
   */
  slowQueryLog?: {
    enabled?: boolean;
    /** 存储集合名 */
    collection?: string;
  };

  /**
   * 自动 ObjectId 转换
   */
  autoConvertObjectId?:
    | boolean
    | {
        fields?: string[];
      };

  /**
   * Model 自动加载配置
   */
  models?: {
    /**
     * Model 定义文件目录（相对于 src/）
     * @default 'models'
     */
    dir?: string;

    /**
     * 外部 shared Model 包名
     * 微服务场景中使用，从 npm 包加载 Model 定义
     * @example '@project/models'
     */
    sharedPackage?: string;

    /**
     * 是否自动注册（扫描目录后自动 Model.define）
     * @default true
     */
    autoRegister?: boolean;
  };

  /**
   * 命名空间（缓存隔离用）
   * @default { scope: 'database' }
   */
  namespace?: {
    scope?: string;
  };

  /**
   * 深分页游标加密密钥
   */
  cursorSecret?: string;

  /**
   * 内存数据库（测试用）
   * 启用后使用 mongodb-memory-server 创建临时实例
   * @default false
   */
  useMemoryServer?: boolean;

  /**
   * 日志器配置
   * - 'app': 使用 app.logger（默认）
   * - false: 禁用日志
   */
  logger?: "app" | false;
}
