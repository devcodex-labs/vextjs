/**
 * MonSQLize 连接管理
 *
 * 调用 monsqlize.connect() 建立数据库连接，
 * 返回增强的连接对象（MonSQLizeConnection），
 * 封装 collection / db / model / client 快捷访问。
 *
 * Fail Fast：连接失败时直接抛出错误，终止框架启动。
 *
 * @module lib/plugins/monsqlize/connection
 * @see 13-monsqlize-plugin.md §2.4（连接管理）
 */

import type { MonSQLize } from "monsqlize";
import type { VextPluginContext } from "../../../types/plugin.js";
import type { MonSQLizeConnection } from "./types.js";

/**
 * 创建数据库连接
 *
 * 调用 monsqlize.connect() 建立连接，
 * 返回增强的连接对象（MonSQLizeConnection）。
 *
 * @param monsqlize MonSQLize 实例（已配置，未连接）
 * @param app       插件上下文（用于日志输出）
 * @returns 增强的连接对象
 * @throws 连接失败时抛出原始错误（Fail Fast）
 */
export async function createConnection(
  monsqlize: MonSQLize,
  app: VextPluginContext,
): Promise<MonSQLizeConnection> {
  // ── 连接数据库（Fail Fast：失败则启动终止）──────────────
  await monsqlize.connect();

  // ── 构建连接对象 ──────────────────────────────────────
  const connection: MonSQLizeConnection = {
    collection: (name: string) => monsqlize.collection(name),

    // db() — 已删除（R4：原实现调用不存在的 monsqlize.db()，为运行时 bug）

    model: (name: string) => monsqlize.model(name),

    // R2：单参数；R1：补全 collection
    use(dbName: string) {
      const prefix = dbName.charAt(0).toUpperCase() + dbName.slice(1);
      return {
        model: (name: string) => {
          const key = prefix + name.charAt(0).toUpperCase() + name.slice(1);
          return monsqlize.model(key);
        },
        collection: (name: string) =>
          monsqlize.scopedCollection(name, { database: dbName }),
      };
    },

    // R3：新增 pool()
    pool(poolName: string) {
      return {
        model: (key: string) =>
          monsqlize.scopedModel(key, { pool: poolName }),

        collection: (name: string) =>
          monsqlize.scopedCollection(name, { pool: poolName }),

        use(dbName: string) {
          const dbPrefix = dbName.charAt(0).toUpperCase() + dbName.slice(1);
          const poolPrefix =
            poolName.charAt(0).toUpperCase() + poolName.slice(1);
          return {
            model: (key: string) => {
              const tail = key.charAt(0).toUpperCase() + key.slice(1);
              // 优先匹配深度-2 注册键（Pool+Db+Name），兼容 models/<pool>/<db>/<name>.ts
              const depth2Key = poolPrefix + dbPrefix + tail;
              // 回落到深度-1 注册键（Db+Name），兼容 models/<db>/<name>.ts
              const depth1Key = dbPrefix + tail;
              try {
                return monsqlize.scopedModel(depth2Key, {
                  pool: poolName,
                  database: dbName,
                });
              } catch (err) {
                const e = err as { code?: string };
                if (e && e.code === "MODEL_NOT_DEFINED") {
                  return monsqlize.scopedModel(depth1Key, {
                    pool: poolName,
                    database: dbName,
                  });
                }
                throw err;
              }
            },
            collection: (name: string) =>
              monsqlize.scopedCollection(name, {
                pool: poolName,
                database: dbName,
              }),
          };
        },
      };
    },

    // 暴露底层 MongoDB Client（事务等高级场景）
    // MonSQLize 将 MongoClient 存储在 _adapter.client（而非 _client）
    get client() {
      const adapter = (monsqlize as any)._adapter;
      const client = adapter?.client;
      if (!client) {
        throw new Error(
          "[monsqlize] MongoDB client is not available. " +
          "Ensure the database connection is established before accessing the client.",
        );
      }
      return client;
    },
  };

  return connection;
}
