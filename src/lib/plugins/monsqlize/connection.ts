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
import type { VextApp } from "../../../types/app.js";
import type { MonSQLizeConnection } from "./types.js";

/**
 * 创建数据库连接
 *
 * 调用 monsqlize.connect() 建立连接，
 * 返回增强的连接对象（MonSQLizeConnection）。
 *
 * @param monsqlize MonSQLize 实例（已配置，未连接）
 * @param app       VextApp 实例（用于日志输出）
 * @returns 增强的连接对象
 * @throws 连接失败时抛出原始错误（Fail Fast）
 */
export async function createConnection(
  monsqlize: MonSQLize,
  app: VextApp,
): Promise<MonSQLizeConnection> {
  // ── 连接数据库（Fail Fast：失败则启动终止）──────────────
  await monsqlize.connect();

  // ── 构建连接对象 ──────────────────────────────────────
  const connection: MonSQLizeConnection = {
    collection: (name: string) => monsqlize.collection(name),
    db: (name: string) => (monsqlize as any).db(name),
    model: (name: string) => monsqlize.model(name),

    // 暴露底层 MongoDB Client（事务等高级场景）
    get client() {
      const client = (monsqlize as any)._client;
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
