/**
 * hello-world 示例 — 多 Adapter 切换验证脚本
 *
 * 在真实的 hello-world 示例项目中，逐个切换 adapter 配置，
 * 分别验证生产模式（bootstrap）和开发模式（devBootstrap）能否正常工作。
 *
 * 🔴 关键设计：每个 adapter 测试在独立子进程中运行，避免 Node.js ESM 模块缓存
 *    导致 bootstrap/config-loader 等模块被复用、配置不生效的问题。
 *
 * 验证内容：
 *   1. 修改 hello-world/src/config/default.js 中的 adapter 字段
 *   2. fork 子进程 → 通过 bootstrap 启动（生产模式）
 *   3. 发送 GET / + GET /health + 404 + Content-Type + OpenAPI 请求验证
 *   4. 关闭服务
 *   5. fork 子进程 → 通过 devBootstrap 启动（开发模式）
 *   6. 发送相同请求验证
 *   7. 关闭服务
 *   8. 恢复原始配置
 *
 * 用法：
 *   node test/verify-hello-world-adapters.mjs
 *   node test/verify-hello-world-adapters.mjs hono         # 只测试指定 adapter
 *   node test/verify-hello-world-adapters.mjs express koa   # 测试多个
 *
 * 前提：
 *   - 需要先 npm run build（使用 dist/ 产物）
 *   - hello-world/node_modules/vextjs symlink 已存在
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const HELLO_WORLD_DIR = join(ROOT, "examples", "hello-world");
const CONFIG_FILE = join(HELLO_WORLD_DIR, "src", "config", "default.js");

// ── 配置 ──────────────────────────────────────────────

const ADAPTERS = ["native", "hono", "fastify", "express", "koa"];
const PROD_BASE_PORT = 19900;
const DEV_BASE_PORT = 19950;
const REQUEST_TIMEOUT = 8000;
const CHILD_STARTUP_TIMEOUT = 15000;
const CHILD_SHUTDOWN_TIMEOUT = 5000;

// ── 过滤 adapter（命令行参数）─────────────────────────

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const selectedAdapters =
  args.length > 0
    ? args.filter((a) => {
        if (!ADAPTERS.includes(a)) {
          console.warn(
            `⚠️  未知 adapter: "${a}"，跳过。可选: ${ADAPTERS.join(", ")}`,
          );
          return false;
        }
        return true;
      })
    : ADAPTERS;

if (selectedAdapters.length === 0) {
  console.error("❌ 没有有效的 adapter 可测试");
  process.exit(1);
}

// ── 工具函数 ──────────────────────────────────────────

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** 备份原始配置 */
let originalConfig = null;

function backupConfig() {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error(`配置文件不存在: ${CONFIG_FILE}`);
  }
  originalConfig = readFileSync(CONFIG_FILE, "utf-8");
}

function restoreConfig() {
  if (originalConfig !== null) {
    writeFileSync(CONFIG_FILE, originalConfig, "utf-8");
  }
}

/**
 * 生成带有指定 adapter 和 port 的配置文件内容
 */
function generateConfig(adapterName, port) {
  return `/**
 * hello-world 示例配置
 *
 * config-loader 会自动以框架内置 DEFAULT_CONFIG 为基底，
 * 深度合并用户配置。因此用户只需覆盖关心的字段，
 * 未声明的字段（如 requestId / rateLimit / cors 等）自动使用框架默认值。
 *
 * 框架默认值参见 src/lib/app.ts 中的 DEFAULT_CONFIG。
 */
export default {
  port: ${port},
  host: "127.0.0.1",

  // ── Adapter 配置 ──────────────────────────────────────
  // 内置 adapter: "native"（默认） | "hono" | "fastify" | "express" | "koa"
  // 也可传入工厂函数（第三方 adapter）:
  //   import { fastifyAdapter } from 'vextjs/adapters/fastify'
  //   adapter: fastifyAdapter({ logger: true })
  adapter: "${adapterName}",

  logger: {
    level: "warn",
  },
  response: {
    hideInternalErrors: false,
  },
  openapi: {
    enabled: true,
  },
};
`;
}

// ── 子进程启动器 ──────────────────────────────────────
//
// 每个 adapter 的每个模式（prod / dev）在独立子进程中运行，
// 通过 IPC 消息通信。子进程脚本内联在下方的 CHILD_SCRIPT 中。

const CHILD_SCRIPT = join(__dirname, ".tmp-child-runner.mjs");

/**
 * 写入子进程执行脚本（一次性写入，所有 adapter 复用）
 *
 * 子进程接收 IPC 消息 { mode, projectRoot, port }，
 * 启动对应模式的 bootstrap/devBootstrap，
 * 启动成功后发送 IPC 消息 { type: 'ready', adapterName, host, port }，
 * 收到 { type: 'shutdown' } 后关闭服务并退出。
 */
function writeChildScript() {
  const script = `
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = ${JSON.stringify(ROOT)};

let serverHandle = null;

process.on("message", async (msg) => {
  if (msg.type === "start") {
    const { mode, projectRoot, port } = msg;
    try {
      if (mode === "prod") {
        const indexPath = pathToFileURL(join(ROOT, "dist", "index.js")).href;
        const { bootstrap } = await import(indexPath);
        const result = await bootstrap(projectRoot);
        serverHandle = result.serverHandle;
        process.send({
          type: "ready",
          adapterName: result.app.adapter.name,
          host: serverHandle.host,
          port: serverHandle.port,
        });
      } else if (mode === "dev") {
        const devPath = pathToFileURL(
          join(ROOT, "dist", "lib", "dev", "dev-bootstrap.js"),
        ).href;
        const { devBootstrap } = await import(devPath);
        const result = await devBootstrap({
          projectRoot,
          skipIpc: true,
        });
        serverHandle = result.serverHandle;
        process.send({
          type: "ready",
          adapterName: result.app.adapter.name,
          host: serverHandle.host,
          port: serverHandle.port,
        });
      }
    } catch (err) {
      process.send({
        type: "error",
        message: err.message,
        stack: err.stack,
      });
    }
  } else if (msg.type === "shutdown") {
    try {
      if (serverHandle) {
        await serverHandle.close();
      }
    } catch {
      // ignore
    }
    process.send({ type: "closed" });
    setTimeout(() => process.exit(0), 100);
  }
});

// 通知父进程子进程已加载完毕，可以接收消息
process.send({ type: "loaded" });
`;
  writeFileSync(CHILD_SCRIPT, script, "utf-8");
}

function cleanupChildScript() {
  try {
    if (existsSync(CHILD_SCRIPT)) {
      unlinkSync(CHILD_SCRIPT);
    }
  } catch {
    // ignore
  }
}

/**
 * 在独立子进程中启动指定模式的服务
 *
 * @returns {{ adapterName, host, port, child, close }}
 */
function startInChild(mode, projectRoot, port) {
  return new Promise((resolve, reject) => {
    const child = fork(CHILD_SCRIPT, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...process.env },
    });

    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        reject(new Error(`子进程启动超时（${CHILD_STARTUP_TIMEOUT}ms）`));
      }
    }, CHILD_STARTUP_TIMEOUT);

    // 收集 stderr 用于错误诊断
    let stderrBuf = "";
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderrBuf += chunk.toString();
      });
    }

    child.on("message", (msg) => {
      if (msg.type === "loaded") {
        // 子进程已加载，发送启动指令
        child.send({ type: "start", mode, projectRoot, port });
      } else if (msg.type === "ready") {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          resolve({
            adapterName: msg.adapterName,
            host: msg.host,
            port: msg.port,
            child,
            async close() {
              return new Promise((res) => {
                const killTimer = setTimeout(() => {
                  try {
                    child.kill("SIGKILL");
                  } catch {
                    // ignore
                  }
                  res();
                }, CHILD_SHUTDOWN_TIMEOUT);

                const onMsg = (m) => {
                  if (m.type === "closed") {
                    clearTimeout(killTimer);
                    child.off("message", onMsg);
                    res();
                  }
                };
                child.on("message", onMsg);
                try {
                  child.send({ type: "shutdown" });
                } catch {
                  clearTimeout(killTimer);
                  res();
                }
              });
            },
          });
        }
      } else if (msg.type === "error") {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
          const err = new Error(msg.message);
          if (msg.stack) err.stack = msg.stack;
          reject(err);
        }
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        const errMsg = stderrBuf.trim()
          ? `子进程异常退出 (code=${code}): ${stderrBuf.trim().split("\n")[0]}`
          : `子进程异常退出 (code=${code})`;
        reject(new Error(errMsg));
      }
    });
  });
}

// ── 请求测试 ──────────────────────────────────────────

/**
 * 对 hello-world 的标准路由执行请求测试
 *
 * @param {string} baseUrl
 * @param {string} adapterName
 * @param {string} modeName - "生产" | "开发"
 * @param {object} [options]
 * @param {boolean} [options.skipOpenApi] - 跳过 OpenAPI 测试（dev 模式不注册 OpenAPI 路由）
 */
async function runTests(baseUrl, adapterName, modeName, options = {}) {
  const results = [];

  // Test 1: GET /
  try {
    const res = await fetch(`${baseUrl}/`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const json = await res.json();
    assert(res.status === 200, `期望 200，实际 ${res.status}`);
    assert(json.code === 0, `期望 code=0，实际 code=${json.code}`);
    assert(
      json.data?.message === "hello world",
      `期望 message="hello world"，实际 ${JSON.stringify(json.data?.message)}`,
    );
    assert(
      typeof json.requestId === "string" && json.requestId.length > 0,
      `期望 requestId 非空字符串，实际 ${JSON.stringify(json.requestId)}`,
    );
    results.push({ name: `GET / (${modeName})`, pass: true });
  } catch (err) {
    results.push({
      name: `GET / (${modeName})`,
      pass: false,
      error: err.message,
    });
  }

  // Test 2: GET /health
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const json = await res.json();
    assert(res.status === 200, `期望 200，实际 ${res.status}`);
    assert(
      json.data?.status === "ok",
      `期望 status="ok"，实际 ${JSON.stringify(json.data?.status)}`,
    );
    assert(
      typeof json.data?.uptime === "number",
      `期望 uptime 为数字，实际 ${typeof json.data?.uptime}`,
    );
    results.push({ name: `GET /health (${modeName})`, pass: true });
  } catch (err) {
    results.push({
      name: `GET /health (${modeName})`,
      pass: false,
      error: err.message,
    });
  }

  // Test 3: 404
  try {
    const res = await fetch(`${baseUrl}/nonexistent`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const json = await res.json();
    assert(res.status === 404, `期望 404，实际 ${res.status}`);
    assert(json.code !== 0, `期望 code 非 0，实际 code=${json.code}`);
    results.push({ name: `GET /nonexistent → 404 (${modeName})`, pass: true });
  } catch (err) {
    results.push({
      name: `GET /nonexistent → 404 (${modeName})`,
      pass: false,
      error: err.message,
    });
  }

  // Test 4: Content-Type + x-request-id 响应头
  try {
    const res = await fetch(`${baseUrl}/`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const ct = res.headers.get("content-type") || "";
    assert(
      ct.includes("application/json"),
      `期望 Content-Type 包含 application/json，实际 "${ct}"`,
    );
    const rid = res.headers.get("x-request-id");
    assert(
      typeof rid === "string" && rid.length > 0,
      `期望 x-request-id 非空，实际 "${rid}"`,
    );
    await res.text(); // consume body
    results.push({
      name: `Content-Type + x-request-id (${modeName})`,
      pass: true,
    });
  } catch (err) {
    results.push({
      name: `Content-Type + x-request-id (${modeName})`,
      pass: false,
      error: err.message,
    });
  }

  // Test 5: OpenAPI /openapi.json
  // 注意：dev-bootstrap 不注册 OpenAPI 路由，这是预期行为，dev 模式跳过此测试
  if (!options.skipOpenApi) {
    try {
      const res = await fetch(`${baseUrl}/openapi.json`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      const json = await res.json();
      assert(res.status === 200, `期望 200，实际 ${res.status}`);
      assert(
        json.openapi?.startsWith("3."),
        `期望 openapi 字段以 "3." 开头，实际 ${JSON.stringify(json.openapi)}`,
      );
      assert(json.paths !== undefined, `期望 paths 字段存在`);
      results.push({ name: `GET /openapi.json (${modeName})`, pass: true });
    } catch (err) {
      results.push({
        name: `GET /openapi.json (${modeName})`,
        pass: false,
        error: err.message,
      });
    }
  }

  return results;
}

// ── 测试单个 adapter ──────────────────────────────────

async function testAdapterInHelloWorld(adapterName, prodPort, devPort) {
  const header = `┌─ ${adapterName.toUpperCase()} Adapter (hello-world 示例)`;
  console.log(`\n${header}`);
  console.log("│");

  const allResults = [];

  // ── 生产模式 ────────────────────────────────────────

  try {
    console.log(`│ 📝 写入配置: adapter="${adapterName}", port=${prodPort}`);
    writeFileSync(CONFIG_FILE, generateConfig(adapterName, prodPort), "utf-8");

    console.log("│ 🚀 [生产模式] 启动 bootstrap（子进程）...");
    const handle = await startInChild("prod", HELLO_WORLD_DIR, prodPort);
    console.log(`│    → 启动成功: http://${handle.host}:${handle.port}`);
    console.log(`│    → adapter.name = "${handle.adapterName}"`);

    await sleep(200);

    // 运行测试
    const baseUrl = `http://127.0.0.1:${handle.port}`;
    const prodTests = await runTests(baseUrl, adapterName, "生产", {
      skipOpenApi: false,
    });
    for (const t of prodTests) {
      console.log(
        `│ ${t.pass ? "✅" : "❌"} ${t.name}${t.error ? ` — ${t.error}` : ""}`,
      );
    }
    allResults.push(...prodTests);

    // 关闭
    console.log("│ 🔌 [生产模式] 关闭服务...");
    await handle.close();
    await sleep(300);
    console.log("│    → 已关闭");
  } catch (err) {
    console.log(`│ 💥 [生产模式] 出错: ${err.message}`);
    if (err.stack) {
      const lines = err.stack.split("\n").slice(1, 4);
      for (const line of lines) {
        console.log(`│    ${line.trim()}`);
      }
    }
    allResults.push({
      name: `[生产模式] 启动`,
      pass: false,
      error: err.message,
    });
  }

  console.log("│");

  // ── 开发模式 ────────────────────────────────────────

  try {
    console.log(`│ 📝 写入配置: adapter="${adapterName}", port=${devPort}`);
    writeFileSync(CONFIG_FILE, generateConfig(adapterName, devPort), "utf-8");

    console.log("│ 🚀 [开发模式] 启动 devBootstrap（子进程）...");
    const handle = await startInChild("dev", HELLO_WORLD_DIR, devPort);
    console.log(`│    → 启动成功: http://${handle.host}:${handle.port}`);
    console.log(`│    → adapter.name = "${handle.adapterName}"`);

    await sleep(300);

    // 运行测试
    const baseUrl = `http://127.0.0.1:${handle.port}`;
    // dev-bootstrap 不注册 OpenAPI 路由（预期行为），跳过 OpenAPI 测试
    const devTests = await runTests(baseUrl, adapterName, "开发", {
      skipOpenApi: true,
    });
    for (const t of devTests) {
      console.log(
        `│ ${t.pass ? "✅" : "❌"} ${t.name}${t.error ? ` — ${t.error}` : ""}`,
      );
    }
    allResults.push(...devTests);

    // 关闭
    console.log("│ 🔌 [开发模式] 关闭服务...");
    await handle.close();
    await sleep(300);
    console.log("│    → 已关闭");
  } catch (err) {
    console.log(`│ 💥 [开发模式] 出错: ${err.message}`);
    if (err.stack) {
      const lines = err.stack.split("\n").slice(1, 4);
      for (const line of lines) {
        console.log(`│    ${line.trim()}`);
      }
    }
    allResults.push({
      name: `[开发模式] 启动`,
      pass: false,
      error: err.message,
    });
  }

  // ── 汇总 ────────────────────────────────────────────

  const passed = allResults.filter((r) => r.pass).length;
  const failed = allResults.filter((r) => !r.pass).length;
  const total = allResults.length;

  console.log("│");
  console.log(
    `│ 📊 结果: ${passed}/${total} 通过${failed > 0 ? `，${failed} 失败` : ""}`,
  );
  console.log(
    `└─ ${failed === 0 ? "✅ PASS" : "❌ FAIL"} — ${adapterName.toUpperCase()} (hello-world)`,
  );

  return { adapter: adapterName, passed, failed, total, results: allResults };
}

// ── 入口 ──────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" VextJS hello-world 示例 — 多 Adapter 切换验证");
  console.log(` 测试 adapter: ${selectedAdapters.join(", ")}`);
  console.log(` 示例目录: ${HELLO_WORLD_DIR}`);
  console.log(
    ` 每个 adapter 测试: 生产模式 5 用例 + 开发模式 4 用例（OpenAPI 仅生产模式）`,
  );
  console.log("═══════════════════════════════════════════════════════════");

  // 检查前提条件
  if (!existsSync(HELLO_WORLD_DIR)) {
    console.error(`❌ hello-world 示例目录不存在: ${HELLO_WORLD_DIR}`);
    process.exit(1);
  }
  if (!existsSync(CONFIG_FILE)) {
    console.error(`❌ 配置文件不存在: ${CONFIG_FILE}`);
    process.exit(1);
  }

  const symlinkTarget = join(HELLO_WORLD_DIR, "node_modules", "vextjs");
  if (!existsSync(symlinkTarget)) {
    console.error(`❌ node_modules/vextjs symlink 不存在: ${symlinkTarget}`);
    process.exit(1);
  }

  // 备份原始配置
  backupConfig();

  // 写入子进程脚本
  writeChildScript();

  const results = [];

  try {
    for (let i = 0; i < selectedAdapters.length; i++) {
      const name = selectedAdapters[i];
      const prodPort = PROD_BASE_PORT + i;
      const devPort = DEV_BASE_PORT + i;
      const result = await testAdapterInHelloWorld(name, prodPort, devPort);
      results.push(result);
    }
  } finally {
    // 始终恢复原始配置
    console.log("\n📝 恢复 hello-world 原始配置...");
    restoreConfig();
    console.log("   → 已恢复");

    // 清理子进程脚本
    cleanupChildScript();
  }

  // ── 汇总报告 ──────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" 汇总报告（hello-world 示例）");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const totalTests = results.reduce((s, r) => s + r.total, 0);

  for (const r of results) {
    const icon = r.failed === 0 ? "✅" : "❌";
    const failedTest = r.results.find((t) => !t.pass);
    const detail = failedTest ? ` (首个错误: ${failedTest.error})` : "";
    console.log(
      `  ${icon} ${r.adapter.padEnd(10)} ${r.passed}/${r.total} 通过${detail}`,
    );
  }

  console.log("");
  console.log(`  总计: ${totalPassed}/${totalTests} 通过，${totalFailed} 失败`);

  const allPassed = totalFailed === 0;
  console.log("");
  console.log(
    allPassed
      ? "🎉 hello-world 示例全部 Adapter 验证通过！"
      : "⚠️  存在失败项，请检查上方日志。",
  );
  console.log("═══════════════════════════════════════════════════════════");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  // 确保异常时也恢复配置
  restoreConfig();
  // 清理子进程脚本
  cleanupChildScript();
  console.error("💥 脚本执行失败:", err);
  process.exit(1);
});
