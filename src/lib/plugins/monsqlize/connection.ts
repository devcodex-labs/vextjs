/**
 * MonSQLize 连接管理
 *
 * 调用 monsqlize.connect() 建立数据库连接，并在原始 MonSQLize 实例上
 * 安装 Vext 的窄兼容扩展：只读 client 与 soft-delete 返回值归一化。
 *
 * Fail Fast：连接失败时直接抛出错误，终止框架启动。
 *
 * @module lib/plugins/monsqlize/connection
 * @see 13-monsqlize-plugin.md §2.4（连接管理）
 */

import type { MonSQLize } from "monsqlize";
import type { VextPluginContext } from "../../../types/plugin.js";
import type { VextDatabase } from "./types.js";

const SOFT_DELETE_COMPAT_MARK = Symbol.for("vext.monsqlize.softDeleteCompat");
const DATABASE_COMPAT_MARK = Symbol.for("vext.monsqlize.databaseCompat");
const ACCESSOR_COMPAT_MARK = Symbol.for("vext.monsqlize.accessorCompat");

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

type CompatTarget = Record<string | symbol, any>;

function decorateModelAccessor(accessor: unknown): unknown {
  if (!accessor || typeof accessor !== "object") {
    return accessor;
  }

  const target = accessor as CompatTarget;
  if (target[ACCESSOR_COMPAT_MARK]) {
    return accessor;
  }

  const originalModel = target.model;
  if (typeof originalModel === "function") {
    target.model = (...args: unknown[]) =>
      applySoftDeleteCompat(originalModel.apply(target, args));
  }

  const originalUse = target.use;
  if (typeof originalUse === "function") {
    target.use = (...args: unknown[]) =>
      decorateModelAccessor(originalUse.apply(target, args));
  }

  Object.defineProperty(target, ACCESSOR_COMPAT_MARK, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return accessor;
}

function installSoftDeleteCompat(monsqlize: MonSQLize): void {
  const target = monsqlize as unknown as CompatTarget;
  if (target[DATABASE_COMPAT_MARK]) {
    return;
  }

  for (const methodName of ["model", "scopedModel"] as const) {
    const original = target[methodName];
    if (typeof original === "function") {
      Object.defineProperty(target, methodName, {
        value: (...args: unknown[]) =>
          applySoftDeleteCompat(original.apply(target, args)),
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
  }

  for (const methodName of ["use", "pool"] as const) {
    const original = target[methodName];
    if (typeof original === "function") {
      Object.defineProperty(target, methodName, {
        value: (...args: unknown[]) =>
          decorateModelAccessor(original.apply(target, args)),
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
  }

  Object.defineProperty(target, DATABASE_COMPAT_MARK, {
    value: true,
    enumerable: false,
    configurable: false,
  });
}

function assertClientSlotAvailable(monsqlize: MonSQLize): void {
  if (Object.prototype.hasOwnProperty.call(monsqlize, "client")) {
    throw new Error(
      '[monsqlize] Cannot expose app.db.client because the MonSQLize instance already owns a "client" property.',
    );
  }
}

function installClientAccessor(monsqlize: MonSQLize): void {
  assertClientSlotAvailable(monsqlize);
  Object.defineProperty(monsqlize, "client", {
    enumerable: true,
    configurable: false,
    get() {
      const client = (monsqlize as unknown as CompatTarget)._adapter?.client;
      if (!client) {
        throw new Error(
          "[monsqlize] MongoDB client is not available. " +
            "Ensure the database connection is established before accessing app.db.client.",
        );
      }
      return client;
    },
  });
}

/**
 * 创建数据库连接
 *
 * 调用 monsqlize.connect() 建立连接，返回同一个原始实例。
 *
 * @param monsqlize MonSQLize 实例（已配置，未连接）
 * @param app       插件上下文（用于日志输出）
 * @returns 已连接且安装窄兼容扩展的原始 MonSQLize 实例
 * @throws 连接失败时抛出原始错误（Fail Fast）
 */
export async function createConnection(
  monsqlize: MonSQLize,
  _app: VextPluginContext,
): Promise<VextDatabase> {
  // 在产生连接 I/O 前先拒绝未来上游或测试替身的自有 client 冲突。
  assertClientSlotAvailable(monsqlize);

  // ── 连接数据库（Fail Fast：失败则启动终止）──────────────
  await monsqlize.connect();

  // connect() 不应新增公开 client，但再次检查可防未来上游版本在连接期注入自有属性。
  installClientAccessor(monsqlize);
  installSoftDeleteCompat(monsqlize);

  return monsqlize as VextDatabase;
}
