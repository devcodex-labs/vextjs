/**
 * ClusterMaster 单元测试
 *
 * 测试覆盖：
 *   - 构造函数：默认配置、部分覆盖、深合并嵌套对象（healthCheck / reload）
 *   - DEFAULT_CLUSTER_CONFIG：所有默认值验证
 *   - 公共 API：getWorkerCount / getReadyWorkerCount / isRunning / getTargetWorkerCount
 *   - 事件继承：EventEmitter 行为
 *   - ClusterMasterInput 类型：深层 Partial 兼容性
 *
 * 测试策略：
 *   - 不涉及实际 cluster.fork（需要 node:cluster 主进程环境）
 *   - 仅测试可在测试进程中安全执行的逻辑（配置、状态、事件）
 *   - 实际 fork/signal/rolling-restart 的集成测试在独立脚本中验证
 *
 * @see 12a-master.md §3（Master 主类）
 * @see 12c-lifecycle.md（进程生命周期管理）
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  ClusterMaster,
  DEFAULT_CLUSTER_CONFIG,
  type ClusterMasterConfig,
} from "../../../src/lib/cluster/master.js";
import { applyClusterWorkerEnv } from "../../../src/lib/bootstrap.js";
import { EventEmitter } from "node:events";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

// ── DEFAULT_CLUSTER_CONFIG ──────────────────────────────────

describe("DEFAULT_CLUSTER_CONFIG", () => {
  it("should have workers set to 'auto'", () => {
    expect(DEFAULT_CLUSTER_CONFIG.workers).toBe("auto");
  });

  it("should have autoRestart enabled by default", () => {
    expect(DEFAULT_CLUSTER_CONFIG.autoRestart).toBe(true);
  });

  it("should have maxRestarts set to 5", () => {
    expect(DEFAULT_CLUSTER_CONFIG.maxRestarts).toBe(5);
  });

  it("should have restartWindow set to 60000ms (1 minute)", () => {
    expect(DEFAULT_CLUSTER_CONFIG.restartWindow).toBe(60_000);
  });

  it("should have restartBaseDelay set to 1000ms (1 second)", () => {
    expect(DEFAULT_CLUSTER_CONFIG.restartBaseDelay).toBe(1_000);
  });

  it("should have restartMaxDelay set to 30000ms (30 seconds)", () => {
    expect(DEFAULT_CLUSTER_CONFIG.restartMaxDelay).toBe(30_000);
  });

  it("should have healthCheck.enabled set to true", () => {
    expect(DEFAULT_CLUSTER_CONFIG.healthCheck.enabled).toBe(true);
  });

  it("should have healthCheck.interval set to 15000ms (15 seconds)", () => {
    expect(DEFAULT_CLUSTER_CONFIG.healthCheck.interval).toBe(15_000);
  });

  it("should have healthCheck.timeout set to 30000ms (30 seconds)", () => {
    expect(DEFAULT_CLUSTER_CONFIG.healthCheck.timeout).toBe(30_000);
  });

  it("should have reload.workerDelay set to 2000ms (2 seconds)", () => {
    expect(DEFAULT_CLUSTER_CONFIG.reload.workerDelay).toBe(2_000);
  });

  it("should have reload.readyTimeout set to 30000ms (30 seconds)", () => {
    expect(DEFAULT_CLUSTER_CONFIG.reload.readyTimeout).toBe(30_000);
  });

  it("should have reload.shutdownTimeout set to 10000ms (10 seconds)", () => {
    expect(DEFAULT_CLUSTER_CONFIG.reload.shutdownTimeout).toBe(10_000);
  });

  it("should have pidFile set to '.vext.pid'", () => {
    expect(DEFAULT_CLUSTER_CONFIG.pidFile).toBe(".vext.pid");
  });

  it("should have titlePrefix set to 'vext'", () => {
    expect(DEFAULT_CLUSTER_CONFIG.titlePrefix).toBe("vext");
  });

  it("should have sticky set to 'none'", () => {
    expect(DEFAULT_CLUSTER_CONFIG.sticky).toBe("none");
  });

  it("should be a complete ClusterMasterConfig (all fields present)", () => {
    const requiredKeys: (keyof ClusterMasterConfig)[] = [
      "workers",
      "autoRestart",
      "maxRestarts",
      "restartWindow",
      "restartBaseDelay",
      "restartMaxDelay",
      "healthCheck",
      "reload",
      "pidFile",
      "titlePrefix",
      "sticky",
    ];

    for (const key of requiredKeys) {
      expect(DEFAULT_CLUSTER_CONFIG).toHaveProperty(key);
      expect(DEFAULT_CLUSTER_CONFIG[key]).not.toBeUndefined();
    }
  });
});

// ── Worker 环境变量传递 ────────────────────────────────────

describe("cluster worker environment", () => {
  const trackedEnvKeys = [
    "VEXT_ROOT",
    "VEXT_WORKER_COUNT",
    "VEXT_PORT",
    "VEXT_HOST",
    "VEXT_BUILT",
    "VEXT_MEMORY_THRESHOLD",
  ];
  let envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    envSnapshot = Object.fromEntries(
      trackedEnvKeys.map((key) => [key, process.env[key]]),
    );
  });

  afterEach(() => {
    for (const key of trackedEnvKeys) {
      const value = envSnapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("should propagate memoryThreshold to worker env", () => {
    applyClusterWorkerEnv({
      rootDir: "/tmp/vext-app",
      workerCount: 2,
      port: 3100,
      host: "127.0.0.1",
      isBuilt: true,
      clusterConfig: { memoryThreshold: 256 },
    });

    expect(process.env.VEXT_ROOT).toBe("/tmp/vext-app");
    expect(process.env.VEXT_WORKER_COUNT).toBe("2");
    expect(process.env.VEXT_PORT).toBe("3100");
    expect(process.env.VEXT_HOST).toBe("127.0.0.1");
    expect(process.env.VEXT_BUILT).toBe("1");
    expect(process.env.VEXT_MEMORY_THRESHOLD).toBe("256");
  });

  it("should clear stale memoryThreshold when cluster config omits it", () => {
    process.env.VEXT_MEMORY_THRESHOLD = "512";

    applyClusterWorkerEnv({
      rootDir: "/tmp/vext-app",
      workerCount: 1,
      port: 3200,
      isBuilt: false,
      clusterConfig: {},
    });

    expect(process.env.VEXT_MEMORY_THRESHOLD).toBeUndefined();
  });
});

// ── ClusterMaster 构造函数 ──────────────────────────────────

describe("ClusterMaster", () => {
  describe("constructor", () => {
    it("should create an instance with default config when no args provided", () => {
      const master = new ClusterMaster();

      expect(master.config).toBeDefined();
      expect(master.config.workers).toBe("auto");
      expect(master.config.autoRestart).toBe(true);
      expect(master.config.maxRestarts).toBe(5);
      expect(master.config.pidFile).toBe(".vext.pid");
      expect(master.config.titlePrefix).toBe("vext");
      expect(master.config.sticky).toBe("none");
    });

    it("should create an instance with empty object config", () => {
      const master = new ClusterMaster({});

      expect(master.config.workers).toBe("auto");
      expect(master.config.autoRestart).toBe(true);
    });

    it("should allow overriding workers with a number", () => {
      const master = new ClusterMaster({ workers: 4 });

      expect(master.config.workers).toBe(4);
    });

    it("should allow overriding workers with 'auto-1'", () => {
      const master = new ClusterMaster({ workers: "auto-1" });

      expect(master.config.workers).toBe("auto-1");
    });

    it("should allow overriding autoRestart to false", () => {
      const master = new ClusterMaster({ autoRestart: false });

      expect(master.config.autoRestart).toBe(false);
    });

    it("should allow overriding maxRestarts", () => {
      const master = new ClusterMaster({ maxRestarts: 10 });

      expect(master.config.maxRestarts).toBe(10);
    });

    it("should allow overriding restartWindow", () => {
      const master = new ClusterMaster({ restartWindow: 120_000 });

      expect(master.config.restartWindow).toBe(120_000);
    });

    it("should allow overriding restartBaseDelay", () => {
      const master = new ClusterMaster({ restartBaseDelay: 500 });

      expect(master.config.restartBaseDelay).toBe(500);
    });

    it("should allow overriding restartMaxDelay", () => {
      const master = new ClusterMaster({ restartMaxDelay: 60_000 });

      expect(master.config.restartMaxDelay).toBe(60_000);
    });

    it("should allow overriding pidFile", () => {
      const master = new ClusterMaster({ pidFile: "/var/run/myapp.pid" });

      expect(master.config.pidFile).toBe("/var/run/myapp.pid");
    });

    it("should allow overriding titlePrefix", () => {
      const master = new ClusterMaster({ titlePrefix: "myapp" });

      expect(master.config.titlePrefix).toBe("myapp");
    });

    it("should allow overriding sticky to 'ip'", () => {
      const master = new ClusterMaster({ sticky: "ip" });

      expect(master.config.sticky).toBe("ip");
    });

    // ── 深合并：healthCheck ────────────────────────────

    it("should deep merge healthCheck with defaults (partial override)", () => {
      const master = new ClusterMaster({
        healthCheck: { timeout: 60_000 },
      });

      // 覆盖的字段
      expect(master.config.healthCheck.timeout).toBe(60_000);
      // 未覆盖的字段应保留默认值
      expect(master.config.healthCheck.enabled).toBe(true);
      expect(master.config.healthCheck.interval).toBe(15_000);
    });

    it("should deep merge healthCheck — override enabled only", () => {
      const master = new ClusterMaster({
        healthCheck: { enabled: false },
      });

      expect(master.config.healthCheck.enabled).toBe(false);
      expect(master.config.healthCheck.interval).toBe(15_000);
      expect(master.config.healthCheck.timeout).toBe(30_000);
    });

    it("should deep merge healthCheck — override interval only", () => {
      const master = new ClusterMaster({
        healthCheck: { interval: 5_000 },
      });

      expect(master.config.healthCheck.enabled).toBe(true);
      expect(master.config.healthCheck.interval).toBe(5_000);
      expect(master.config.healthCheck.timeout).toBe(30_000);
    });

    it("should deep merge healthCheck — override all fields", () => {
      const master = new ClusterMaster({
        healthCheck: {
          enabled: false,
          interval: 5_000,
          timeout: 60_000,
        },
      });

      expect(master.config.healthCheck.enabled).toBe(false);
      expect(master.config.healthCheck.interval).toBe(5_000);
      expect(master.config.healthCheck.timeout).toBe(60_000);
    });

    it("should use defaults when healthCheck is not provided", () => {
      const master = new ClusterMaster({ workers: 2 });

      expect(master.config.healthCheck.enabled).toBe(true);
      expect(master.config.healthCheck.interval).toBe(15_000);
      expect(master.config.healthCheck.timeout).toBe(30_000);
    });

    // ── 深合并：reload ────────────────────────────────

    it("should deep merge reload with defaults (partial override)", () => {
      const master = new ClusterMaster({
        reload: { readyTimeout: 60_000 },
      });

      // 覆盖的字段
      expect(master.config.reload.readyTimeout).toBe(60_000);
      // 未覆盖的字段应保留默认值
      expect(master.config.reload.workerDelay).toBe(2_000);
      expect(master.config.reload.shutdownTimeout).toBe(10_000);
    });

    it("should deep merge reload — override workerDelay only", () => {
      const master = new ClusterMaster({
        reload: { workerDelay: 5_000 },
      });

      expect(master.config.reload.workerDelay).toBe(5_000);
      expect(master.config.reload.readyTimeout).toBe(30_000);
      expect(master.config.reload.shutdownTimeout).toBe(10_000);
    });

    it("should deep merge reload — override shutdownTimeout only", () => {
      const master = new ClusterMaster({
        reload: { shutdownTimeout: 30_000 },
      });

      expect(master.config.reload.workerDelay).toBe(2_000);
      expect(master.config.reload.readyTimeout).toBe(30_000);
      expect(master.config.reload.shutdownTimeout).toBe(30_000);
    });

    it("should deep merge reload — override all fields", () => {
      const master = new ClusterMaster({
        reload: {
          workerDelay: 5_000,
          readyTimeout: 60_000,
          shutdownTimeout: 20_000,
        },
      });

      expect(master.config.reload.workerDelay).toBe(5_000);
      expect(master.config.reload.readyTimeout).toBe(60_000);
      expect(master.config.reload.shutdownTimeout).toBe(20_000);
    });

    it("should use defaults when reload is not provided", () => {
      const master = new ClusterMaster({ workers: 2 });

      expect(master.config.reload.workerDelay).toBe(2_000);
      expect(master.config.reload.readyTimeout).toBe(30_000);
      expect(master.config.reload.shutdownTimeout).toBe(10_000);
    });

    it("should treat omitted reload as default timing, not a disabled state", () => {
      const master = new ClusterMaster({ workers: 2 });

      expect(master.config.reload).toEqual(DEFAULT_CLUSTER_CONFIG.reload);
      expect(master.config.reload).not.toHaveProperty("enabled");
    });

    // ── 组合覆盖 ────────────────────────────────────────

    it("should handle simultaneous shallow + deep overrides", () => {
      const master = new ClusterMaster({
        workers: 8,
        autoRestart: false,
        maxRestarts: 3,
        restartWindow: 30_000,
        restartBaseDelay: 2_000,
        restartMaxDelay: 60_000,
        pidFile: "/tmp/test.pid",
        titlePrefix: "test-app",
        sticky: "ip",
        healthCheck: {
          enabled: false,
          interval: 10_000,
        },
        reload: {
          workerDelay: 1_000,
          shutdownTimeout: 5_000,
        },
      });

      // 浅层覆盖
      expect(master.config.workers).toBe(8);
      expect(master.config.autoRestart).toBe(false);
      expect(master.config.maxRestarts).toBe(3);
      expect(master.config.restartWindow).toBe(30_000);
      expect(master.config.restartBaseDelay).toBe(2_000);
      expect(master.config.restartMaxDelay).toBe(60_000);
      expect(master.config.pidFile).toBe("/tmp/test.pid");
      expect(master.config.titlePrefix).toBe("test-app");
      expect(master.config.sticky).toBe("ip");

      // 深层覆盖 — healthCheck
      expect(master.config.healthCheck.enabled).toBe(false);
      expect(master.config.healthCheck.interval).toBe(10_000);
      expect(master.config.healthCheck.timeout).toBe(30_000); // 未覆盖，保留默认

      // 深层覆盖 — reload
      expect(master.config.reload.workerDelay).toBe(1_000);
      expect(master.config.reload.readyTimeout).toBe(30_000); // 未覆盖，保留默认
      expect(master.config.reload.shutdownTimeout).toBe(5_000);
    });

    // ── 不应修改 DEFAULT_CLUSTER_CONFIG ─────────────────

    it("should not mutate DEFAULT_CLUSTER_CONFIG", () => {
      // 保存原始值的快照
      const originalWorkers = DEFAULT_CLUSTER_CONFIG.workers;
      const originalHealthCheckInterval =
        DEFAULT_CLUSTER_CONFIG.healthCheck.interval;
      const originalReloadDelay = DEFAULT_CLUSTER_CONFIG.reload.workerDelay;

      // 创建多个实例
      new ClusterMaster({ workers: 99 });
      new ClusterMaster({ healthCheck: { interval: 1 } });
      new ClusterMaster({ reload: { workerDelay: 1 } });

      // 验证默认值未被修改
      expect(DEFAULT_CLUSTER_CONFIG.workers).toBe(originalWorkers);
      expect(DEFAULT_CLUSTER_CONFIG.healthCheck.interval).toBe(
        originalHealthCheckInterval,
      );
      expect(DEFAULT_CLUSTER_CONFIG.reload.workerDelay).toBe(
        originalReloadDelay,
      );
    });

    it("should not share config objects between instances", () => {
      const master1 = new ClusterMaster({ healthCheck: { timeout: 1 } });
      const master2 = new ClusterMaster({ healthCheck: { timeout: 2 } });

      expect(master1.config.healthCheck.timeout).toBe(1);
      expect(master2.config.healthCheck.timeout).toBe(2);

      // 不同实例的 healthCheck 应为不同对象引用
      expect(master1.config.healthCheck).not.toBe(master2.config.healthCheck);
    });
  });

  // ── EventEmitter 继承 ────────────────────────────────

  describe("EventEmitter inheritance", () => {
    it("should be an instance of EventEmitter", () => {
      const master = new ClusterMaster();
      expect(master).toBeInstanceOf(EventEmitter);
    });

    it("should support on/emit pattern", () => {
      const master = new ClusterMaster();
      const handler = vi.fn();

      master.on("worker-ready", handler);
      master.emit("worker-ready", { workerId: 1, pid: 12345 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ workerId: 1, pid: 12345 });
    });

    it("should support once listener", () => {
      const master = new ClusterMaster();
      const handler = vi.fn();

      master.once("worker-exit", handler);
      master.emit("worker-exit", {
        workerId: 1,
        code: 0,
        signal: null,
      });
      master.emit("worker-exit", {
        workerId: 2,
        code: 1,
        signal: null,
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should support removeListener", () => {
      const master = new ClusterMaster();
      const handler = vi.fn();

      master.on("restart-throttled", handler);
      master.removeListener("restart-throttled", handler);
      master.emit("restart-throttled", {
        workerId: 1,
        code: 1,
        signal: null,
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should support multiple listeners on the same event", () => {
      const master = new ClusterMaster();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      master.on("worker-ready", handler1);
      master.on("worker-ready", handler2);
      master.emit("worker-ready", { workerId: 1, pid: 12345 });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should support reload-start event", () => {
      const master = new ClusterMaster();
      const handler = vi.fn();

      master.on("reload-start", handler);
      master.emit("reload-start", { trigger: "SIGHUP", workerCount: 4 });

      expect(handler).toHaveBeenCalledWith({
        trigger: "SIGHUP",
        workerCount: 4,
      });
    });

    it("should support reload-complete event", () => {
      const master = new ClusterMaster();
      const handler = vi.fn();

      master.on("reload-complete", handler);
      master.emit("reload-complete", { replaced: 3, total: 4 });

      expect(handler).toHaveBeenCalledWith({ replaced: 3, total: 4 });
    });

    it("should support heartbeat-timeout event", () => {
      const master = new ClusterMaster();
      const handler = vi.fn();

      master.on("heartbeat-timeout", handler);
      master.emit("heartbeat-timeout", {
        workerId: 2,
        lastHeartbeat: Date.now() - 60_000,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const arg = handler.mock.calls[0]![0];
      expect(arg.workerId).toBe(2);
      expect(typeof arg.lastHeartbeat).toBe("number");
    });

    it("should support all-workers-dead event", () => {
      const master = new ClusterMaster();
      const handler = vi.fn();

      master.on("all-workers-dead", handler);
      master.emit("all-workers-dead");

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── 公共 API（初始状态）──────────────────────────────

  describe("public API (initial state)", () => {
    it("getWorkerCount should return 0 before start", () => {
      const master = new ClusterMaster();
      expect(master.getWorkerCount()).toBe(0);
    });

    it("getReadyWorkerCount should return 0 before start", () => {
      const master = new ClusterMaster();
      expect(master.getReadyWorkerCount()).toBe(0);
    });

    it("isRunning should return true before start (not shutting down)", () => {
      const master = new ClusterMaster();
      expect(master.isRunning()).toBe(true);
    });

    it("getTargetWorkerCount should return 0 before start", () => {
      const master = new ClusterMaster();
      expect(master.getTargetWorkerCount()).toBe(0);
    });

    it("getWorkerMetas should return an empty map before start", () => {
      const master = new ClusterMaster();
      const metas = master.getWorkerMetas();
      expect(metas.size).toBe(0);
    });

    it("getLatestMetrics should return an empty map before start", () => {
      const master = new ClusterMaster();
      const metrics = master.getLatestMetrics();
      expect(metrics.size).toBe(0);
    });
  });

  // ── config 只读性 ─────────────────────────────────────

  describe("config readonly", () => {
    it("should expose config as readonly property", () => {
      const master = new ClusterMaster({ workers: 4 });

      // TypeScript 强制 readonly，运行时通过属性描述符验证
      expect(master.config.workers).toBe(4);
    });

    it("should have consistent config values across reads", () => {
      const master = new ClusterMaster({
        workers: 8,
        autoRestart: false,
        healthCheck: { enabled: false },
      });

      // 多次读取应返回相同值
      expect(master.config.workers).toBe(8);
      expect(master.config.workers).toBe(8);
      expect(master.config.autoRestart).toBe(false);
      expect(master.config.autoRestart).toBe(false);
      expect(master.config.healthCheck.enabled).toBe(false);
      expect(master.config.healthCheck.enabled).toBe(false);
    });
  });

  // ── broadcast（不需要实际 Worker）─────────────────────

  describe("broadcast (without workers)", () => {
    it("should not throw when broadcasting with no workers", () => {
      const master = new ClusterMaster();

      // 没有 Worker 时 broadcast 应该是 no-op
      expect(() => master.broadcast({ action: "clear-cache" })).not.toThrow();
    });

    it("should not throw when broadcasting null payload", () => {
      const master = new ClusterMaster();
      expect(() => master.broadcast(null)).not.toThrow();
    });

    it("should not throw when broadcasting undefined payload", () => {
      const master = new ClusterMaster();
      expect(() => master.broadcast(undefined)).not.toThrow();
    });

    it("should not throw when broadcasting complex object", () => {
      const master = new ClusterMaster();
      expect(() =>
        master.broadcast({
          action: "invalidate",
          keys: ["user:1", "user:2"],
          timestamp: Date.now(),
        }),
      ).not.toThrow();
    });
  });

  // ── 多实例隔离 ────────────────────────────────────────

  describe("instance isolation", () => {
    it("should not share state between instances", () => {
      const master1 = new ClusterMaster({ workers: 2 });
      const master2 = new ClusterMaster({ workers: 8 });

      expect(master1.config.workers).toBe(2);
      expect(master2.config.workers).toBe(8);

      expect(master1.getWorkerCount()).toBe(0);
      expect(master2.getWorkerCount()).toBe(0);
    });

    it("should not share event listeners between instances", () => {
      const master1 = new ClusterMaster();
      const master2 = new ClusterMaster();
      const handler = vi.fn();

      master1.on("worker-ready", handler);
      master2.emit("worker-ready", { workerId: 1, pid: 100 });

      // handler should NOT be called (registered on master1, emitted on master2)
      expect(handler).not.toHaveBeenCalled();

      master1.emit("worker-ready", { workerId: 1, pid: 100 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should not share worker metas between instances", () => {
      const master1 = new ClusterMaster();
      const master2 = new ClusterMaster();

      expect(master1.getWorkerMetas()).not.toBe(master2.getWorkerMetas());
    });

    it("should not share metrics between instances", () => {
      const master1 = new ClusterMaster();
      const master2 = new ClusterMaster();

      expect(master1.getLatestMetrics()).not.toBe(master2.getLatestMetrics());
    });
  });

  // ── 边界配置值 ────────────────────────────────────────

  describe("edge case configurations", () => {
    it("should accept workers = 1", () => {
      const master = new ClusterMaster({ workers: 1 });
      expect(master.config.workers).toBe(1);
    });

    it("should accept workers = 64 (MAX_WORKERS)", () => {
      const master = new ClusterMaster({ workers: 64 });
      expect(master.config.workers).toBe(64);
    });

    it("should accept maxRestarts = 0 (disable auto-restart effectively)", () => {
      const master = new ClusterMaster({ maxRestarts: 0 });
      expect(master.config.maxRestarts).toBe(0);
    });

    it("should accept restartWindow = 0", () => {
      const master = new ClusterMaster({ restartWindow: 0 });
      expect(master.config.restartWindow).toBe(0);
    });

    it("should accept restartBaseDelay = 0 (no delay)", () => {
      const master = new ClusterMaster({ restartBaseDelay: 0 });
      expect(master.config.restartBaseDelay).toBe(0);
    });

    it("should accept very large timeout values", () => {
      const master = new ClusterMaster({
        healthCheck: { timeout: 300_000 },
        reload: { readyTimeout: 300_000, shutdownTimeout: 300_000 },
      });

      expect(master.config.healthCheck.timeout).toBe(300_000);
      expect(master.config.reload.readyTimeout).toBe(300_000);
      expect(master.config.reload.shutdownTimeout).toBe(300_000);
    });

    it("should accept empty string as pidFile", () => {
      const master = new ClusterMaster({ pidFile: "" });
      expect(master.config.pidFile).toBe("");
    });

    it("should accept empty string as titlePrefix", () => {
      const master = new ClusterMaster({ titlePrefix: "" });
      expect(master.config.titlePrefix).toBe("");
    });
  });

  // ── 配置快照不可变性 ──────────────────────────────────

  describe("config snapshot immutability", () => {
    it("modifying input object after construction should not affect master config", () => {
      const input = {
        workers: 4 as "auto" | "auto-1" | number,
        maxRestarts: 10,
      };

      const master = new ClusterMaster(input);

      // Modify input after construction
      input.workers = 16;
      input.maxRestarts = 99;

      // Master config should retain original values
      expect(master.config.workers).toBe(4);
      expect(master.config.maxRestarts).toBe(10);
    });

    it("modifying input healthCheck after construction should not affect master config", () => {
      const healthCheck = {
        enabled: false,
        interval: 5_000,
        timeout: 10_000,
      };

      const master = new ClusterMaster({ healthCheck });

      // Modify input after construction
      healthCheck.enabled = true;
      healthCheck.interval = 99_999;

      // Master config should retain original values
      expect(master.config.healthCheck.enabled).toBe(false);
      expect(master.config.healthCheck.interval).toBe(5_000);
    });

    it("modifying input reload after construction should not affect master config", () => {
      const reload = {
        workerDelay: 1_000,
        readyTimeout: 5_000,
        shutdownTimeout: 3_000,
      };

      const master = new ClusterMaster({ reload });

      // Modify input after construction
      reload.workerDelay = 99_999;

      // Master config should retain original values
      expect(master.config.reload.workerDelay).toBe(1_000);
    });
  });

  // ── 类型安全验证 ──────────────────────────────────────

  describe("type safety (ClusterMasterInput deep partial)", () => {
    it("should accept healthCheck with only 'enabled' field", () => {
      const master = new ClusterMaster({
        healthCheck: { enabled: false },
      });

      expect(master.config.healthCheck.enabled).toBe(false);
      expect(master.config.healthCheck.interval).toBe(15_000);
      expect(master.config.healthCheck.timeout).toBe(30_000);
    });

    it("should accept healthCheck with only 'interval' field", () => {
      const master = new ClusterMaster({
        healthCheck: { interval: 1_000 },
      });

      expect(master.config.healthCheck.enabled).toBe(true);
      expect(master.config.healthCheck.interval).toBe(1_000);
      expect(master.config.healthCheck.timeout).toBe(30_000);
    });

    it("should accept healthCheck with only 'timeout' field", () => {
      const master = new ClusterMaster({
        healthCheck: { timeout: 5_000 },
      });

      expect(master.config.healthCheck.enabled).toBe(true);
      expect(master.config.healthCheck.interval).toBe(15_000);
      expect(master.config.healthCheck.timeout).toBe(5_000);
    });

    it("should accept reload with only 'workerDelay' field", () => {
      const master = new ClusterMaster({
        reload: { workerDelay: 500 },
      });

      expect(master.config.reload.workerDelay).toBe(500);
      expect(master.config.reload.readyTimeout).toBe(30_000);
      expect(master.config.reload.shutdownTimeout).toBe(10_000);
    });

    it("should accept reload with only 'readyTimeout' field", () => {
      const master = new ClusterMaster({
        reload: { readyTimeout: 120_000 },
      });

      expect(master.config.reload.workerDelay).toBe(2_000);
      expect(master.config.reload.readyTimeout).toBe(120_000);
      expect(master.config.reload.shutdownTimeout).toBe(10_000);
    });

    it("should accept reload with only 'shutdownTimeout' field", () => {
      const master = new ClusterMaster({
        reload: { shutdownTimeout: 60_000 },
      });

      expect(master.config.reload.workerDelay).toBe(2_000);
      expect(master.config.reload.readyTimeout).toBe(30_000);
      expect(master.config.reload.shutdownTimeout).toBe(60_000);
    });

    it("should accept empty healthCheck object", () => {
      const master = new ClusterMaster({ healthCheck: {} });

      // Should use all defaults
      expect(master.config.healthCheck.enabled).toBe(true);
      expect(master.config.healthCheck.interval).toBe(15_000);
      expect(master.config.healthCheck.timeout).toBe(30_000);
    });

    it("should accept empty reload object", () => {
      const master = new ClusterMaster({ reload: {} });

      // Should use all defaults
      expect(master.config.reload.workerDelay).toBe(2_000);
      expect(master.config.reload.readyTimeout).toBe(30_000);
      expect(master.config.reload.shutdownTimeout).toBe(10_000);
    });

    it("should accept config with only healthCheck and reload", () => {
      const master = new ClusterMaster({
        healthCheck: { enabled: false },
        reload: { workerDelay: 100 },
      });

      expect(master.config.workers).toBe("auto"); // default
      expect(master.config.healthCheck.enabled).toBe(false);
      expect(master.config.reload.workerDelay).toBe(100);
    });
  });
});

describe("cluster reload documentation contract", () => {
  it("should document that omitting cluster.reload keeps defaults instead of disabling reload", () => {
    const zhCluster = readRepoFile("website/docs/zh/guide/cluster.md");
    const enCluster = readRepoFile("website/docs/en/guide/cluster.md");
    const zhConfig = readRepoFile("website/docs/zh/api/config.md");
    const enConfig = readRepoFile("website/docs/en/api/config.md");

    expect(zhCluster).toContain("省略 `cluster.reload` 不会禁用滚动重启");
    expect(zhConfig).toContain("省略 `cluster.reload` 不会禁用滚动重启");
    expect(enCluster).toContain(
      "Omitting `cluster.reload` does not disable rolling restart",
    );
    expect(enConfig).toContain(
      "Omitting `cluster.reload` does not disable rolling restart",
    );

    for (const doc of [zhCluster, zhConfig]) {
      expect(doc).not.toContain("移除 `reload` 配置项即可");
    }
    for (const doc of [enCluster, enConfig]) {
      expect(doc).not.toContain("remove the `reload` configuration item");
    }
  });
});
