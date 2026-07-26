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
import type { MonSQLizeConnection, PoolAccessor } from "./types.js";

const SOFT_DELETE_COMPAT_MARK = Symbol.for("vext.monsqlize.softDeleteCompat");

type SoftDeleteCompatModel = Record<string | symbol, any> & {
  softDeleteConfig?: { enabled?: boolean };
};

function normalizeSoftDeleteResult(
  model: SoftDeleteCompatModel,
  result: unknown,
): unknown {
  if (
    model.softDeleteConfig?.enabled !== true ||
    !result ||
    typeof result !== "object"
  ) {
    return result;
  }

  const record = result as Record<string, unknown>;
  if (
    record.deletedCount === undefined &&
    typeof record.modifiedCount === "number"
  ) {
    record.deletedCount = record.modifiedCount;
  }
  return result;
}

function wrapSoftDeleteMethod(
  model: SoftDeleteCompatModel,
  methodName: "deleteOne" | "deleteMany",
): void {
  const original = model[methodName];
  if (typeof original !== "function") {
    return;
  }

  model[methodName] = async (...args: unknown[]) => {
    const result = await original.apply(model, args);
    return normalizeSoftDeleteResult(model, result);
  };
}

function applySoftDeleteCompat<T>(model: T): T {
  if (!model || typeof model !== "object") {
    return model;
  }

  const target = model as SoftDeleteCompatModel;
  if (target[SOFT_DELETE_COMPAT_MARK]) {
    return model;
  }

  wrapSoftDeleteMethod(target, "deleteOne");
  wrapSoftDeleteMethod(target, "deleteMany");
  Object.defineProperty(target, SOFT_DELETE_COMPAT_MARK, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return model;
}

/**
 * Fail-fast pool existence check via monSQLize's own diagnostics.
 * Throws immediately with monSQLize codes:
 * - NO_POOL_MANAGER when pools are not configured
 * - POOL_NOT_FOUND (with err.available) when the named pool is missing
 */
function assertPoolExists(monsqlize: MonSQLize, poolName: string): void {
  monsqlize.pool(poolName);
}

/**
 * Build a pool-scoped accessor only after the pool has been validated.
 * Validation runs before the accessor object is created so callers cannot
 * obtain model/collection/use handles for a missing pool name.
 */
function createPoolAccessor(
  monsqlize: MonSQLize,
  poolName: string,
): PoolAccessor {
  assertPoolExists(monsqlize, poolName);

  return {
    model: (key: string) =>
      applySoftDeleteCompat(monsqlize.scopedModel(key, { pool: poolName })),

    collection: (name: string) =>
      monsqlize.scopedCollection(name, { pool: poolName }),

    use(dbName: string) {
      const dbPrefix = dbName.charAt(0).toUpperCase() + dbName.slice(1);
      const poolPrefix = poolName.charAt(0).toUpperCase() + poolName.slice(1);
      return {
        model: (key: string) => {
          const tail = key.charAt(0).toUpperCase() + key.slice(1);
          // Prefer depth-2 keys (Pool+Db+Name) for models/<pool>/<db>/<name>.ts
          const depth2Key = poolPrefix + dbPrefix + tail;
          // Fall back to depth-1 keys (Db+Name) for models/<db>/<name>.ts
          const depth1Key = dbPrefix + tail;
          try {
            return applySoftDeleteCompat(
              monsqlize.scopedModel(depth2Key, {
                pool: poolName,
                database: dbName,
              }),
            );
          } catch (err) {
            const e = err as { code?: string };
            if (e && e.code === "MODEL_NOT_DEFINED") {
              return applySoftDeleteCompat(
                monsqlize.scopedModel(depth1Key, {
                  pool: poolName,
                  database: dbName,
                }),
              );
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
}

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
  _app: VextPluginContext,
): Promise<MonSQLizeConnection> {
  // ── 连接数据库（Fail Fast：失败则启动终止）──────────────
  await monsqlize.connect();

  // ── 构建连接对象 ──────────────────────────────────────
  const connection: MonSQLizeConnection = {
    collection: (name: string) => monsqlize.collection(name),

    // db() — 已删除（R4：原实现调用不存在的 monsqlize.db()，为运行时 bug）

    model: (name: string) => applySoftDeleteCompat(monsqlize.model(name)),

    // R2：单参数；R1：补全 collection
    use(dbName: string) {
      const prefix = dbName.charAt(0).toUpperCase() + dbName.slice(1);
      return {
        model: (name: string) => {
          const key = prefix + name.charAt(0).toUpperCase() + name.slice(1);
          return applySoftDeleteCompat(monsqlize.model(key));
        },
        collection: (name: string) =>
          monsqlize.scopedCollection(name, { database: dbName }),
      };
    },

    // R3：pool(name) validates immediately, then returns a scoped accessor
    pool(poolName: string) {
      return createPoolAccessor(monsqlize, poolName);
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
