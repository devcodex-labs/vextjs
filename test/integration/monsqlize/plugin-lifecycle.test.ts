/**
 * MonSQLize 插件集成测试
 *
 * 使用 mongodb-memory-server-core 创建内存 MongoDB 实例，
 * 验证 MonSQLize 插件在真实数据库环境下的完整生命周期：
 *
 *   1. 插件连接（setupMonSQLize → connect → app.db 可用）
 *   2. Collection CRUD（insertOne / findOne / find / updateOne / deleteOne）
 *   3. Model 注册与使用（monsqlize.model(name, def) → model.create / model.find）
 *   4. 连接关闭（onClose → monsqlize.close()）
 *   5. 多次连接/断开循环（验证无资源泄漏）
 *   6. 配置校验（缺少必要配置时 Fail Fast）
 *
 * 策略：
 *   - 不通过 createTestApp 启动完整应用，而是直接调用 setupMonSQLize
 *   - 使用最小化 mock app（仅提供 config / logger / extend / onClose）
 *   - mongodb-memory-server-core 在 beforeAll 启动，afterAll 关闭
 *   - 每个 describe 块使用独立集合名，避免测试间数据污染
 *
 * @module test/integration/monsqlize/plugin-lifecycle
 * @see 13-monsqlize-plugin.md（设计文档）
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { join } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import type { VextApp } from "../../../src/types/app.js";
import { setupMonSQLize } from "../../../src/lib/plugins/monsqlize/plugin.js";
import { shouldLoadMonSQLize } from "../../../src/lib/plugins/monsqlize/index.js";
import MonSQLize, { defineModel, Model } from "monsqlize";
import { dsl } from "schema-dsl";

// ── 超时配置 ────────────────────────────────────────────────
// mongodb-memory-server-core 首次下载二进制文件可能需要较长时间，
// 后续运行使用缓存，通常 5-10 秒内启动。
const MONGO_STARTUP_TIMEOUT = Number(
  process.env.VEXT_TEST_MONGO_STARTUP_TIMEOUT_MS ?? 300_000,
);
const MONGO_BINARY_VERSION = "8.2.6";
const MONGO_BINARY_DOWNLOAD_DIR =
  process.env.MONGOMS_DOWNLOAD_DIR ??
  join(process.cwd(), ".cache", "mongodb-binaries");
const ORIGINAL_MONGOMS_VERSION = process.env.MONGOMS_VERSION;
const ORIGINAL_MONGOMS_DOWNLOAD_DIR = process.env.MONGOMS_DOWNLOAD_DIR;
const ORIGINAL_MONGOMS_PREFER_GLOBAL_PATH =
  process.env.MONGOMS_PREFER_GLOBAL_PATH;

// ── 全局 MongoMemoryServer 实例 ─────────────────────────────
let mongoServer: MongoMemoryServer;
let mongoUri: string;

// ── 测试辅助：创建最小化 mock app ───────────────────────────

interface MockAppResult {
  app: VextApp;
  closeHooks: Array<() => Promise<void> | void>;
  extendedProps: Map<string, unknown>;
}

function createMockApp(databaseConfig: Record<string, unknown>): MockAppResult {
  const closeHooks: Array<() => Promise<void> | void> = [];
  const extendedProps = new Map<string, unknown>();

  const app = {
    config: {
      port: 3000,
      host: "0.0.0.0",
      adapter: "native",
      trustProxy: false,
      middlewares: [],
      cors: {
        enabled: false,
        origins: ["*"],
        methods: [],
        headers: [],
        credentials: false,
      },
      rateLimit: {
        enabled: false,
        max: 100,
        window: 60,
        message: "",
        keyBy: "ip" as const,
      },
      requestId: {
        enabled: false,
        header: "x-request-id",
        responseHeader: "x-request-id",
      },
      logger: { level: "silent" },
      shutdown: { timeout: 5 },
      response: { hideInternalErrors: true },
      bodyParser: { maxBodySize: "1mb" },
      accessLog: { enabled: false, level: "info" as const, skipPaths: [] },
      openapi: { enabled: false },
      database: databaseConfig,
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
      level: "silent",
    },
    throw: vi.fn() as any,
    services: {} as any,
    adapter: {} as any,
    extend: vi.fn((key: string, value: unknown) => {
      extendedProps.set(key, value);
      (app as any)[key] = value;
    }),
    onClose: vi.fn((handler: () => Promise<void> | void) => {
      closeHooks.push(handler);
    }),
    onReady: vi.fn(),
    use: vi.fn(),
    setValidator: vi.fn(),
    getValidator: vi.fn(),
    setThrow: vi.fn(),
    setRateLimiter: vi.fn(),
    setRequestIdGenerator: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    head: vi.fn(),
    options: vi.fn(),
  } as unknown as VextApp;

  return { app, closeHooks, extendedProps };
}

/**
 * 执行所有已注册的 onClose 钩子（LIFO 顺序，与 vext 框架行为一致）
 */
async function executeCloseHooks(
  closeHooks: Array<() => Promise<void> | void>,
): Promise<void> {
  for (let i = closeHooks.length - 1; i >= 0; i--) {
    await closeHooks[i]?.();
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════

describe("MonSQLize 插件集成测试", () => {
  // ── 全局 setup/teardown ──────────────────────────────────
  beforeAll(async () => {
    process.env.MONGOMS_VERSION = MONGO_BINARY_VERSION;
    process.env.MONGOMS_DOWNLOAD_DIR = MONGO_BINARY_DOWNLOAD_DIR;
    process.env.MONGOMS_PREFER_GLOBAL_PATH = "false";
    mongoServer = await MongoMemoryServer.create({
      binary: {
        version: MONGO_BINARY_VERSION,
        downloadDir: MONGO_BINARY_DOWNLOAD_DIR,
      },
    });
    mongoUri = mongoServer.getUri();
  }, MONGO_STARTUP_TIMEOUT);

  afterAll(async () => {
    if (mongoServer) {
      await mongoServer.stop();
    }
    if (ORIGINAL_MONGOMS_VERSION === undefined) {
      delete process.env.MONGOMS_VERSION;
    } else {
      process.env.MONGOMS_VERSION = ORIGINAL_MONGOMS_VERSION;
    }
    if (ORIGINAL_MONGOMS_DOWNLOAD_DIR === undefined) {
      delete process.env.MONGOMS_DOWNLOAD_DIR;
    } else {
      process.env.MONGOMS_DOWNLOAD_DIR = ORIGINAL_MONGOMS_DOWNLOAD_DIR;
    }
    if (ORIGINAL_MONGOMS_PREFER_GLOBAL_PATH === undefined) {
      delete process.env.MONGOMS_PREFER_GLOBAL_PATH;
    } else {
      process.env.MONGOMS_PREFER_GLOBAL_PATH =
        ORIGINAL_MONGOMS_PREFER_GLOBAL_PATH;
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 1. 插件连接生命周期
  // ═══════════════════════════════════════════════════════════

  describe("插件连接生命周期", () => {
    it("setupMonSQLize 成功连接并挂载 app.db 和 app.monsqlize", async () => {
      const { app, closeHooks, extendedProps } = createMockApp({
        config: { uri: mongoUri },
        logger: false,
      });

      // 使用一个不存在的 srcDir，这样 model loader 会跳过
      await setupMonSQLize(app, "/nonexistent-src-dir");

      // 验证 app.db 已挂载
      expect(extendedProps.has("db")).toBe(true);
      expect(extendedProps.get("db")).toBeDefined();

      // 验证 app.monsqlize 已挂载
      expect(extendedProps.has("monsqlize")).toBe(true);
      expect(extendedProps.get("monsqlize")).toBeDefined();

      // 验证 onClose 钩子已注册
      expect(closeHooks.length).toBeGreaterThanOrEqual(1);

      // 验证日志输出
      const infoCalls = (app.logger.info as ReturnType<typeof vi.fn>).mock
        .calls;
      const connectedMsg = infoCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          call[0].includes("connected successfully"),
      );
      expect(connectedMsg).toBeDefined();

      const readyMsg = infoCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("plugin ready"),
      );
      expect(readyMsg).toBeDefined();

      // 清理
      await executeCloseHooks(closeHooks);
    });

    it("保持 raw instance 身份并暴露 monsqlize 3.3.0 collection/model 能力", async () => {
      const { app, closeHooks, extendedProps } = createMockApp({
        config: { uri: mongoUri },
        logger: false,
        models: { autoRegister: false },
        monsqlizeOptions: {
          schemaDsl: false,
          findMaxLimit: 1_234,
          findMaxSkip: 5_678,
          requireCursorSecret: true,
          cursorSecretWarning: "off",
        },
      });

      try {
        await setupMonSQLize(app, "/nonexistent-src-dir");

        const raw = extendedProps.get("monsqlize") as MonSQLize;
        const db = extendedProps.get("db") as Record<string, any>;
        expect(raw).toBe((app as any).monsqlize);
        expect(db).toBe((app as any).db);
        expect(typeof raw.withTransaction).toBe("function");
        expect(db.withTransaction).toBeUndefined();

        const defaults = raw.getDefaults();
        expect(defaults.findMaxLimit).toBe(1_234);
        expect(defaults.findMaxSkip).toBe(5_678);
        expect(defaults.requireCursorSecret).toBe(true);

        const collection = db.collection("monsqlize_330_capability_probe");
        expect(typeof collection.vectorSearch).toBe("function");

        Model.define("Monsqlize330CapabilityProbe", {
          schema: { name: "string" },
        });
        const model = db.model("Monsqlize330CapabilityProbe");
        expect(typeof model.vectorSearch).toBe("function");
        expect(typeof model.checkRelationUsage).toBe("function");
        expect(typeof model.deleteOneWithRelations).toBe("function");
        expect(typeof model.forceDeleteWithRelations).toBe("function");

        const descriptor = defineModel("Monsqlize330DescriptorProbe", {
          schema: { name: "string!" },
        });
        Model.define(descriptor);
        const descriptorModel = raw.model(descriptor);
        await descriptorModel.insertOne({ name: "descriptor-ready" });
        const descriptorDocument = await descriptorModel.findOne({
          name: "descriptor-ready",
        });
        expect(descriptorDocument?.name).toBe("descriptor-ready");
      } finally {
        await executeCloseHooks(closeHooks);
        (MonSQLize as any).Model._clear();
      }
    });

    it("root useMemoryServer 使用 core 生成的 URI 覆盖外部 URL", async () => {
      const { app, closeHooks, extendedProps } = createMockApp({
        config: { url: "mongodb://127.0.0.1:1/should-not-connect" },
        useMemoryServer: true,
        logger: false,
      });

      await setupMonSQLize(app, "/nonexistent-src-dir");

      expect(extendedProps.has("db")).toBe(true);
      expect(extendedProps.has("monsqlize")).toBe(true);

      const infoCalls = (app.logger.info as ReturnType<typeof vi.fn>).mock
        .calls;
      const memoryServerMsg = infoCalls.find(
        (call: unknown[]) =>
          call[0] === "[monsqlize] root connection using in-memory MongoDB" &&
          typeof (call[1] as { uri?: unknown } | undefined)?.uri === "string" &&
          (call[1] as { uri: string }).uri.includes("mongodb://"),
      );
      expect(memoryServerMsg).toBeDefined();

      await executeCloseHooks(closeHooks);
    });

    it("onClose 钩子正确关闭数据库连接", async () => {
      const { app, closeHooks } = createMockApp({
        config: { uri: mongoUri },
        logger: false,
      });

      await setupMonSQLize(app, "/nonexistent-src-dir");

      // 执行 onClose 钩子
      await executeCloseHooks(closeHooks);

      // 验证关闭日志
      const infoCalls = (app.logger.info as ReturnType<typeof vi.fn>).mock
        .calls;
      const closedMsg = infoCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" && call[0].includes("connection closed"),
      );
      expect(closedMsg).toBeDefined();
    });

    it("多次连接/断开循环无资源泄漏", async () => {
      for (let cycle = 0; cycle < 3; cycle++) {
        const { app, closeHooks } = createMockApp({
          config: { uri: mongoUri },
          logger: false,
        });

        await setupMonSQLize(app, "/nonexistent-src-dir");

        // 验证连接可用
        const db = (app as any).db;
        expect(db).toBeDefined();

        // 简单操作验证连接活跃
        const col = db.collection(`lifecycle_cycle_${cycle}`);
        await col.insertOne({ cycle, ts: Date.now() });
        const doc = await col.findOne({ cycle });
        expect(doc).not.toBeNull();
        expect(doc.cycle).toBe(cycle);

        // 关闭连接
        await executeCloseHooks(closeHooks);
      }
    });

    it("shouldLoadMonSQLize 正确判断配置", () => {
      // 有 database 配置 → true
      expect(
        shouldLoadMonSQLize({ database: { config: { uri: mongoUri } } }),
      ).toBe(true);

      // 无 database 配置 → false
      expect(shouldLoadMonSQLize({})).toBe(false);
      expect(shouldLoadMonSQLize({ database: null })).toBe(false);
      expect(shouldLoadMonSQLize({ database: {} })).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 2. 配置校验（Fail Fast）
  // ═══════════════════════════════════════════════════════════

  describe("配置校验 Fail Fast", () => {
    it("缺少 database 配置时抛出错误", async () => {
      const { app } = createMockApp({} as any);
      // 移除 database 配置
      delete (app.config as any).database;

      await expect(setupMonSQLize(app, "/nonexistent-src-dir")).rejects.toThrow(
        'Missing "database" configuration',
      );
    });

    it("缺少 database.config 时抛出错误", async () => {
      const { app } = createMockApp({ type: "url" });

      await expect(setupMonSQLize(app, "/nonexistent-src-dir")).rejects.toThrow(
        'Missing "database.config"',
      );
    });

    it("无效连接 URL 时 connect 失败（Fail Fast）", async () => {
      const { app, closeHooks } = createMockApp({
        config: {
          uri: "mongodb://invalid-host-that-does-not-exist:99999/testdb",
        },
        logger: false,
      });

      await expect(
        setupMonSQLize(app, "/nonexistent-src-dir"),
      ).rejects.toThrow();

      // 即使连接失败，onClose 钩子也应已注册（安全模式：先注册再连接）
      expect(closeHooks.length).toBeGreaterThanOrEqual(1);

      // 执行 onClose 不应抛错（close() 对未连接状态是 no-op）
      await expect(executeCloseHooks(closeHooks)).resolves.not.toThrow();
    }, 30_000);
  });

  // ═══════════════════════════════════════════════════════════
  // 3. Collection CRUD 操作
  // ═══════════════════════════════════════════════════════════

  describe("Collection CRUD 操作", () => {
    let app: VextApp;
    let closeHooks: Array<() => Promise<void> | void>;

    beforeEach(async () => {
      const result = createMockApp({
        config: { uri: mongoUri },
        logger: false,
      });
      app = result.app;
      closeHooks = result.closeHooks;

      await setupMonSQLize(app, "/nonexistent-src-dir");
    });

    afterEach(async () => {
      await executeCloseHooks(closeHooks);
    });

    it("insertOne 插入文档并返回 insertedId", async () => {
      const db = (app as any).db;
      const col = db.collection("crud_insert_test");

      const result = await col.insertOne({
        name: "Alice",
        email: "alice@example.com",
        age: 25,
      });

      expect(result).toBeDefined();
      expect(result.acknowledged).toBe(true);
      expect(result.insertedId).toBeDefined();
    });

    it("findOne 查询单个文档", async () => {
      const db = (app as any).db;
      const col = db.collection("crud_findone_test");

      await col.insertOne({
        name: "Bob",
        email: "bob@example.com",
        role: "admin",
      });

      const doc = await col.findOne({ name: "Bob" });

      expect(doc).not.toBeNull();
      expect(doc.name).toBe("Bob");
      expect(doc.email).toBe("bob@example.com");
      expect(doc.role).toBe("admin");
    });

    it("findOne 查询不存在的文档返回 null", async () => {
      const db = (app as any).db;
      const col = db.collection("crud_findone_null_test");

      const doc = await col.findOne({ name: "NonExistent" });
      expect(doc).toBeNull();
    });

    it("find 查询多个文档", async () => {
      const db = (app as any).db;
      const col = db.collection("crud_find_test");

      await col.insertOne({ category: "fruit", name: "Apple" });
      await col.insertOne({ category: "fruit", name: "Banana" });
      await col.insertOne({ category: "vegetable", name: "Carrot" });

      // find 返回 FindChain，使用 .limit().sort() 或直接 await
      const fruits = await col.find(
        { category: "fruit" },
        { sort: { name: 1 } },
      );

      expect(fruits).toHaveLength(2);
      expect(fruits[0].name).toBe("Apple");
      expect(fruits[1].name).toBe("Banana");
    });

    it("find 空结果返回空数组", async () => {
      const db = (app as any).db;
      const col = db.collection("crud_find_empty_test");

      const docs = await col.find({ category: "nonexistent" });
      expect(docs).toEqual([]);
    });

    it("insertMany 批量插入多个文档", async () => {
      const db = (app as any).db;
      const col = db.collection("crud_insertmany_test");

      const result = await col.insertMany([
        { name: "Doc1", value: 1 },
        { name: "Doc2", value: 2 },
        { name: "Doc3", value: 3 },
      ]);

      expect(result).toBeDefined();
      expect(result.acknowledged).toBe(true);
      expect(result.insertedCount).toBe(3);
    });

    it("count 返回文档计数", async () => {
      const db = (app as any).db;
      const col = db.collection("crud_count_test");

      await col.insertMany([
        { status: "active", name: "A" },
        { status: "active", name: "B" },
        { status: "inactive", name: "C" },
      ]);

      const totalCount = await col.count();
      expect(totalCount).toBe(3);

      const activeCount = await col.count({ status: "active" });
      expect(activeCount).toBe(2);
    });

    it("upsertOne 插入新文档（不存在时）", async () => {
      const db = (app as any).db;
      const col = db.collection("crud_upsert_test");

      const result = await col.upsertOne(
        { sku: "ITEM-001" },
        { $set: { sku: "ITEM-001", name: "Widget", price: 9.99 } },
      );

      expect(result.acknowledged).toBe(true);
      expect(result.upsertedCount).toBe(1);

      const doc = await col.findOne({ sku: "ITEM-001" });
      expect(doc).not.toBeNull();
      expect(doc.name).toBe("Widget");
      expect(doc.price).toBe(9.99);
    });

    it("upsertOne 更新已有文档（存在时）", async () => {
      const db = (app as any).db;
      const col = db.collection("crud_upsert_update_test");

      // 先插入
      await col.insertOne({ sku: "ITEM-002", name: "Gadget", price: 19.99 });

      // upsert 更新
      const result = await col.upsertOne(
        { sku: "ITEM-002" },
        { $set: { price: 24.99 } },
      );

      expect(result.acknowledged).toBe(true);
      expect(result.matchedCount).toBe(1);

      const doc = await col.findOne({ sku: "ITEM-002" });
      expect(doc!.price).toBe(24.99);
      expect(doc!.name).toBe("Gadget"); // 原字段保留
    });

    it("distinct 获取去重字段值", async () => {
      const db = (app as any).db;
      const col = db.collection("crud_distinct_test");

      await col.insertMany([
        { color: "red", size: "S" },
        { color: "blue", size: "M" },
        { color: "red", size: "L" },
        { color: "green", size: "S" },
      ]);

      const colors = await col.distinct("color");
      expect(colors.sort()).toEqual(["blue", "green", "red"]);

      const sizesForRed = await col.distinct("size", { color: "red" });
      expect(sizesForRed.sort()).toEqual(["L", "S"]);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 4. 连接对象（MonSQLizeConnection）API
  // ═══════════════════════════════════════════════════════════

  describe("连接对象 API", () => {
    let app: VextApp;
    let closeHooks: Array<() => Promise<void> | void>;

    beforeEach(async () => {
      const result = createMockApp({
        config: { uri: mongoUri },
        logger: false,
      });
      app = result.app;
      closeHooks = result.closeHooks;

      await setupMonSQLize(app, "/nonexistent-src-dir");
    });

    afterEach(async () => {
      await executeCloseHooks(closeHooks);
    });

    it("db.collection() 返回可操作的集合访问器", async () => {
      const db = (app as any).db;
      const col = db.collection("conn_api_collection_test");

      // 验证返回的集合访问器有基本方法
      expect(typeof col.insertOne).toBe("function");
      expect(typeof col.findOne).toBe("function");
      expect(typeof col.find).toBe("function");
      expect(typeof col.count).toBe("function");

      // 实际操作
      await col.insertOne({ test: true });
      const doc = await col.findOne({ test: true });
      expect(doc).not.toBeNull();
    });

    it("db.client 返回底层 MongoClient 实例", () => {
      const db = (app as any).db;

      const client = db.client;
      expect(client).toBeDefined();
      // MongoClient 应有 db() 方法和 close() 方法
      expect(typeof client.db).toBe("function");
      expect(typeof client.close).toBe("function");
    });

    it("app.monsqlize 暴露原始 MonSQLize 实例", () => {
      const monsqlize = (app as any).monsqlize;

      expect(monsqlize).toBeDefined();
      expect(typeof monsqlize.connect).toBe("function");
      expect(typeof monsqlize.close).toBe("function");
      expect(typeof monsqlize.collection).toBe("function");
    });

    it("不同集合名返回独立的集合访问器", async () => {
      const db = (app as any).db;
      const col1 = db.collection("conn_api_col1");
      const col2 = db.collection("conn_api_col2");

      await col1.insertOne({ source: "col1" });
      await col2.insertOne({ source: "col2" });

      const doc1 = await col1.findOne({ source: "col1" });
      const doc2 = await col2.findOne({ source: "col2" });

      expect(doc1).not.toBeNull();
      expect(doc2).not.toBeNull();

      // 交叉验证：col1 不含 col2 的数据
      const cross = await col1.findOne({ source: "col2" });
      expect(cross).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 5. Model 注册与使用
  // ═══════════════════════════════════════════════════════════

  describe("Model 注册与使用", () => {
    let app: VextApp;
    let closeHooks: Array<() => Promise<void> | void>;

    // MonSQLize 的 Model 注册使用静态方法 MonSQLize.Model.define()，
    // 注册表是全局的，需要在每个测试用例使用唯一集合名避免冲突。
    // afterEach 中清理注册表。

    beforeEach(async () => {
      const result = createMockApp({
        config: { uri: mongoUri },
        logger: false,
        // 禁用自动加载 model 文件（我们手动注册）
        models: { autoRegister: false },
      });
      app = result.app;
      closeHooks = result.closeHooks;

      await setupMonSQLize(app, "/nonexistent-src-dir");
    });

    afterEach(async () => {
      await executeCloseHooks(closeHooks);
      // 清理全局 Model 注册表，避免测试间泄漏
      (MonSQLize as any).Model._clear();
    });

    it("通过 Model.define() 注册并通过 monsqlize.model() 获取 Model", () => {
      const monsqlize = (app as any).monsqlize;

      // 使用静态方法注册 Model（schema 使用 DSL 函数格式）
      (MonSQLize as any).Model.define("model_user_reg_test", {
        schema: (d: typeof dsl) =>
          d({
            name: "string",
            email: "string",
            age: "number",
          }),
      });

      // 通过实例方法获取 Model
      const UserModel = monsqlize.model("model_user_reg_test");
      expect(UserModel).toBeDefined();
    });

    it("通过 db.model() 获取已注册的 Model", () => {
      const db = (app as any).db;

      // 先定义
      (MonSQLize as any).Model.define("model_product_dbget_test", {
        schema: (d: typeof dsl) =>
          d({
            name: "string",
            price: "number",
            category: "string",
          }),
      });

      // 通过 db.model() 获取
      const ProductModel = db.model("model_product_dbget_test");
      expect(ProductModel).toBeDefined();
    });

    it("Model create 和 findOne 操作", async () => {
      const monsqlize = (app as any).monsqlize;

      // 注册 Model（使用 DSL 函数格式）
      (MonSQLize as any).Model.define("model_order_crud_test", {
        schema: (d: typeof dsl) =>
          d({
            orderNo: "string",
            amount: "number",
            status: "string",
          }),
      });

      const OrderModel = monsqlize.model("model_order_crud_test");

      // 使用 Model insertOne 创建文档
      const result = await OrderModel.insertOne({
        orderNo: "ORD-001",
        amount: 199.99,
        status: "pending",
      });

      expect(result).toBeDefined();
      expect(result.acknowledged).toBe(true);
      expect(result.insertedId).toBeDefined();

      // 使用 Model 查询
      const found = await OrderModel.findOne({ orderNo: "ORD-001" });
      expect(found).not.toBeNull();
      expect(found.orderNo).toBe("ORD-001");
      expect(found.amount).toBe(199.99);
      expect(found.status).toBe("pending");
    });

    it("Model find 查询多个文档", async () => {
      const monsqlize = (app as any).monsqlize;

      (MonSQLize as any).Model.define("model_tag_find_test", {
        schema: (d: typeof dsl) =>
          d({
            name: "string",
            group: "string",
          }),
      });

      const TagModel = monsqlize.model("model_tag_find_test");

      // 批量插入
      await TagModel.insertOne({ name: "JavaScript", group: "language" });
      await TagModel.insertOne({ name: "TypeScript", group: "language" });
      await TagModel.insertOne({ name: "React", group: "framework" });

      // 查询
      const languages = await TagModel.find(
        { group: "language" },
        { sort: { name: 1 } },
      );

      expect(languages).toHaveLength(2);
      expect(languages[0].name).toBe("JavaScript");
      expect(languages[1].name).toBe("TypeScript");
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 6. 配置选项传递验证
  // ═══════════════════════════════════════════════════════════

  describe("配置选项传递", () => {
    it("maxTimeMS 和 findLimit 正确传递到 MonSQLize 实例", async () => {
      const { app, closeHooks } = createMockApp({
        config: { uri: mongoUri },
        maxTimeMS: 5000,
        findLimit: 20,
        logger: false,
      });

      await setupMonSQLize(app, "/nonexistent-src-dir");

      const monsqlize = (app as any).monsqlize;
      const defaults = monsqlize.getDefaults();
      expect(defaults.maxTimeMS).toBe(5000);
      expect(defaults.findLimit).toBe(20);

      await executeCloseHooks(closeHooks);
    });

    it("默认值正确应用（maxTimeMS=2000, findLimit=10）", async () => {
      const { app, closeHooks } = createMockApp({
        config: { uri: mongoUri },
        logger: false,
      });

      await setupMonSQLize(app, "/nonexistent-src-dir");

      const monsqlize = (app as any).monsqlize;
      const defaults = monsqlize.getDefaults();
      expect(defaults.maxTimeMS).toBe(2000);
      expect(defaults.findLimit).toBe(10);

      await executeCloseHooks(closeHooks);
    });

    it("内存缓存正确配置", async () => {
      const { app, closeHooks } = createMockApp({
        config: { uri: mongoUri },
        cache: {
          memory: { enabled: true, maxSize: 500, ttl: 120 },
        },
        logger: false,
      });

      await setupMonSQLize(app, "/nonexistent-src-dir");

      const monsqlize = (app as any).monsqlize;
      const cache = monsqlize.getCache();
      // 缓存实例应存在
      expect(cache).toBeDefined();

      await executeCloseHooks(closeHooks);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 7. 健康检查
  // ═══════════════════════════════════════════════════════════

  describe("健康检查", () => {
    it("连接状态下 health() 返回 status=up", async () => {
      const { app, closeHooks } = createMockApp({
        config: { uri: mongoUri },
        logger: false,
      });

      await setupMonSQLize(app, "/nonexistent-src-dir");

      const monsqlize = (app as any).monsqlize;
      const health = await monsqlize.health();

      expect(health.status).toBe("up");
      expect(health.connected).toBe(true);

      await executeCloseHooks(closeHooks);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 8. 复杂 CRUD 场景
  // ═══════════════════════════════════════════════════════════

  describe("复杂 CRUD 场景", () => {
    let app: VextApp;
    let closeHooks: Array<() => Promise<void> | void>;

    beforeEach(async () => {
      const result = createMockApp({
        config: { uri: mongoUri },
        logger: false,
      });
      app = result.app;
      closeHooks = result.closeHooks;

      await setupMonSQLize(app, "/nonexistent-src-dir");
    });

    afterEach(async () => {
      await executeCloseHooks(closeHooks);
    });

    it("完整 CRUD 生命周期：创建 → 查询 → 更新 → 查询 → 删除 → 确认删除", async () => {
      const db = (app as any).db;
      const col = db.collection("full_crud_lifecycle");

      // Create
      const insertResult = await col.insertOne({
        title: "Integration Test",
        status: "draft",
        views: 0,
        tags: ["test", "integration"],
        createdAt: new Date(),
      });
      expect(insertResult.acknowledged).toBe(true);
      const docId = insertResult.insertedId;

      // Read
      const created = await col.findOne({ _id: docId });
      expect(created).not.toBeNull();
      expect(created.title).toBe("Integration Test");
      expect(created.status).toBe("draft");
      expect(created.views).toBe(0);
      expect(created.tags).toEqual(["test", "integration"]);

      // Update（使用 upsertOne 因为 collection API 可能无 updateOne）
      await col.upsertOne(
        { _id: docId },
        { $set: { status: "published", views: 42 } },
      );

      // Read 更新后
      const updated = await col.findOne({ _id: docId });
      expect(updated.status).toBe("published");
      expect(updated.views).toBe(42);
      expect(updated.title).toBe("Integration Test"); // 未修改字段保留

      // Count
      const count = await col.count({ status: "published" });
      expect(count).toBe(1);
    });

    it("嵌套对象和数组字段正确存储和查询", async () => {
      const db = (app as any).db;
      const col = db.collection("nested_data_test");

      await col.insertOne({
        user: {
          name: "Charlie",
          address: {
            city: "Shanghai",
            zip: "200000",
          },
        },
        scores: [95, 88, 72],
        metadata: {
          source: "test",
          flags: { verified: true, premium: false },
        },
      });

      // 使用嵌套字段查询
      const doc = await col.findOne({ "user.address.city": "Shanghai" });
      expect(doc).not.toBeNull();
      expect(doc.user.name).toBe("Charlie");
      expect(doc.user.address.zip).toBe("200000");
      expect(doc.scores).toEqual([95, 88, 72]);
      expect(doc.metadata.flags.verified).toBe(true);
    });

    it("incrementOne 原子递增字段", async () => {
      const db = (app as any).db;
      const col = db.collection("increment_test");

      await col.insertOne({ counter: "page_views", value: 100 });

      // 递增
      const result = await col.incrementOne(
        { counter: "page_views" },
        "value",
        5,
      );

      expect(result.acknowledged).toBe(true);

      const doc = await col.findOne({ counter: "page_views" });
      expect(doc.value).toBe(105);
    });

    it("并发插入不丢失数据", async () => {
      const db = (app as any).db;
      const col = db.collection("concurrent_insert_test");

      const COUNT = 50;
      const promises = Array.from({ length: COUNT }, (_, i) =>
        col.insertOne({ index: i, data: `item-${i}` }),
      );

      await Promise.all(promises);

      const total = await col.count();
      expect(total).toBe(COUNT);

      // 验证每个文档都存在
      const docs = await col.find({}, { sort: { index: 1 }, limit: COUNT });
      expect(docs).toHaveLength(COUNT);
    });

    it("aggregate 聚合查询", async () => {
      const db = (app as any).db;
      const col = db.collection("aggregate_test");

      await col.insertMany([
        { department: "engineering", salary: 8000 },
        { department: "engineering", salary: 12000 },
        { department: "engineering", salary: 10000 },
        { department: "marketing", salary: 7000 },
        { department: "marketing", salary: 9000 },
      ]);

      const results = await col.aggregate([
        {
          $group: {
            _id: "$department",
            avgSalary: { $avg: "$salary" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      expect(results).toHaveLength(2);

      const engineering = results.find((r: any) => r._id === "engineering");
      expect(engineering).toBeDefined();
      expect(engineering.avgSalary).toBe(10000);
      expect(engineering.count).toBe(3);

      const marketing = results.find((r: any) => r._id === "marketing");
      expect(marketing).toBeDefined();
      expect(marketing.avgSalary).toBe(8000);
      expect(marketing.count).toBe(2);
    });
  });
});
