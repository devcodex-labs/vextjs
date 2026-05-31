/**
 * Adapter 启动验证脚本
 *
 * 验证 Hono / Fastify / Express / Koa / Native 五个 adapter 能否正常：
 *   1. 通过 bootstrap 启动（生产模式模拟）
 *   2. 响应 GET / 请求（返回正确的 JSON 格式）
 *   3. 响应 GET /health 请求
 *   4. 404 处理
 *   5. 优雅关闭
 *
 * 用法：
 *   node test/verify-adapters-startup.mjs
 *   node test/verify-adapters-startup.mjs hono        # 只测试指定 adapter
 *   node test/verify-adapters-startup.mjs fastify koa  # 测试多个
 *
 * 注意：
 *   - 需要先 npm run build（使用 dist/ 产物）
 *   - 每个 adapter 使用不同端口避免冲突
 *   - 脚本会自动创建临时项目目录用于测试
 */

import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

// ── 配置 ──────────────────────────────────────────────

const ADAPTERS = ["hono", "fastify", "express", "koa", "native"];
const BASE_PORT = 17700;
const REQUEST_TIMEOUT = 5000;
const SHUTDOWN_WAIT = 500;

// ── 过滤 adapter（命令行参数） ─────────────────────────

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

/**
 * 创建临时测试项目目录
 */
function setupTempProject(adapterName, port) {
  const tmpDir = join(ROOT, `test/.tmp-verify-${adapterName}`);

  // 清理旧目录
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // 创建目录结构
  mkdirSync(join(tmpDir, "src", "config"), { recursive: true });
  mkdirSync(join(tmpDir, "src", "routes"), { recursive: true });

  // 写入配置文件
  writeFileSync(
    join(tmpDir, "src", "config", "default.js"),
    `export default {
  port: ${port},
  host: "127.0.0.1",
  adapter: "${adapterName}",
  logger: {
    level: "warn",
  },
  response: {
    hideInternalErrors: false,
  },
  bodyParser: {
    maxBodySize: "1mb",
  },
  multipart: {
    enabled: true,
    maxFileSize: 1024,
  },
};
`,
  );

  // 写入路由文件
  writeFileSync(
    join(tmpDir, "src", "routes", "index.js"),
    `import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    res.json({ message: "hello from ${adapterName}" });
  });

  app.get("/health", {}, async (_req, res) => {
    res.json({ status: "ok", adapter: "${adapterName}", uptime: process.uptime() });
  });

  app.get("/echo/:name", {}, async (req, res) => {
    const name = req.params.name;
    res.json({ echo: name, adapter: "${adapterName}" });
  });

  app.post("/body-test", {}, async (req, res) => {
    const body = req.body;
    res.json({ received: body, adapter: "${adapterName}" });
  });

  app.post("/body-limit", { bodyParser: { maxBodySize: "32b" } }, async (req, res) => {
    res.json({ adapter: "${adapterName}", received: req.body });
  });

  app.post("/body-limit-override", { override: { maxBodySize: "32b" } }, async (req, res) => {
    res.json({ adapter: "${adapterName}", received: req.body });
  });

  app.post("/body-parser-disabled", { bodyParser: { enabled: false } }, async (req, res) => {
    res.json({
      adapter: "${adapterName}",
      bodyType: typeof req.body,
      hasBody: req.body !== undefined,
    });
  });

  app.post("/multipart-limit", {
    bodyParser: { maxBodySize: "64b" },
    multipart: { enabled: true, maxFileSize: 1024 },
  }, async (req, res) => {
    res.json({ adapter: "${adapterName}", files: req.files?.length ?? 0 });
  });
});
`,
  );

  // 创建 node_modules/vextjs symlink
  const nmDir = join(tmpDir, "node_modules");
  mkdirSync(nmDir, { recursive: true });
  const targetLink = join(nmDir, "vextjs");
  try {
    symlinkSync(ROOT, targetLink, "junction");
  } catch {
    try {
      symlinkSync(ROOT, targetLink, "dir");
    } catch (e2) {
      console.error(`  ⚠️  无法创建 symlink: ${e2.message}`);
      console.error(`  请手动创建: mklink /J "${targetLink}" "${ROOT}"`);
      throw e2;
    }
  }

  return tmpDir;
}

// ── 测试用例 ──────────────────────────────────────────

const TEST_CASES = [
  {
    name: "GET / — 基础路由",
    run: async (baseUrl, adapterName) => {
      const res = await fetch(`${baseUrl}/`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      const json = await res.json();
      assert(res.status === 200, `期望 200，实际 ${res.status}`);
      assert(json.code === 0, `期望 code=0，实际 code=${json.code}`);
      assert(
        json.data?.message === `hello from ${adapterName}`,
        `期望 message="hello from ${adapterName}"，实际 ${JSON.stringify(json.data?.message)}`,
      );
      assert(
        typeof json.requestId === "string" && json.requestId.length > 0,
        `期望 requestId 为非空字符串，实际 ${JSON.stringify(json.requestId)}`,
      );
      return json;
    },
  },
  {
    name: "GET /health — 健康检查",
    run: async (baseUrl, adapterName) => {
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
        json.data?.adapter === adapterName,
        `期望 adapter="${adapterName}"，实际 ${JSON.stringify(json.data?.adapter)}`,
      );
      return json;
    },
  },
  {
    name: "GET /echo/:name — 路径参数",
    run: async (baseUrl, adapterName) => {
      const res = await fetch(`${baseUrl}/echo/world`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      const json = await res.json();
      assert(res.status === 200, `期望 200，实际 ${res.status}`);
      assert(
        json.data?.echo === "world",
        `期望 echo="world"，实际 ${JSON.stringify(json.data?.echo)}`,
      );
      assert(
        json.data?.adapter === adapterName,
        `期望 adapter="${adapterName}"，实际 ${JSON.stringify(json.data?.adapter)}`,
      );
      return json;
    },
  },
  {
    name: "POST /body-test — JSON Body 解析",
    run: async (baseUrl, adapterName) => {
      const payload = { foo: "bar", num: 42 };
      const res = await fetch(`${baseUrl}/body-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      const json = await res.json();
      assert(res.status === 200, `期望 200，实际 ${res.status}`);
      assert(
        json.data?.received?.foo === "bar",
        `期望 received.foo="bar"，实际 ${JSON.stringify(json.data?.received)}`,
      );
      assert(
        json.data?.received?.num === 42,
        `期望 received.num=42，实际 ${JSON.stringify(json.data?.received?.num)}`,
      );
      return json;
    },
  },
  {
    name: "GET /nonexistent — 404 处理",
    run: async (baseUrl) => {
      const res = await fetch(`${baseUrl}/nonexistent`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      const json = await res.json();
      assert(res.status === 404, `期望 404，实际 ${res.status}`);
      assert(
        json.code !== 0,
        `期望 code 非 0（表示错误），实际 code=${json.code}`,
      );
      return json;
    },
  },
  {
    name: "Content-Type + x-request-id 响应头检查",
    run: async (baseUrl) => {
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
        `期望 x-request-id 响应头存在且非空，实际 "${rid}"`,
      );
      await res.text(); // consume body
      return { contentType: ct, requestId: rid };
    },
  },
  {
    name: "请求唯一性 — requestId 不重复",
    run: async (baseUrl) => {
      const res1 = await fetch(`${baseUrl}/`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      const json1 = await res1.json();
      const res2 = await fetch(`${baseUrl}/`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      const json2 = await res2.json();
      assert(
        json1.requestId !== json2.requestId,
        `两次请求的 requestId 应不同，实际都是 "${json1.requestId}"`,
      );
      return { id1: json1.requestId, id2: json2.requestId };
    },
  },
  {
    name: "POST /body-limit — route-level body size limit",
    run: async (baseUrl, adapterName) => {
      const res = await fetch(`${baseUrl}/body-limit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(128) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

      const json = await res.json();
      assert(res.status === 413, `${adapterName} route-level body limit expected 413, got ${res.status}`);
      assert(
        json.code === 413 || json.error === "Payload Too Large" || json.message === "Payload Too Large",
        `${adapterName} route-level body limit returned unexpected payload: ${JSON.stringify(json)}`
      );
      return json;
    },
  },
  {
    name: "POST /body-limit-override — override.maxBodySize alias",
    run: async (baseUrl, adapterName) => {
      const res = await fetch(`${baseUrl}/body-limit-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(128) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

      const json = await res.json();
      assert(res.status === 413, `${adapterName} override.maxBodySize expected 413, got ${res.status}`);
      assert(
        json.code === 413 || json.error === "Payload Too Large" || json.message === "Payload Too Large",
        `${adapterName} override.maxBodySize returned unexpected payload: ${JSON.stringify(json)}`
      );
      return json;
    },
  },
  {
    name: "POST /body-parser-disabled — route-level body parser disabled",
    run: async (baseUrl, adapterName) => {
      const res = await fetch(`${baseUrl}/body-parser-disabled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(32) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

      const json = await res.json();
      assert(res.status === 200, `${adapterName} bodyParser.enabled=false expected 200, got ${res.status}`);
      assert(
        json.data?.bodyType === "undefined" && json.data?.hasBody === false,
        `${adapterName} bodyParser.enabled=false should leave req.body undefined, got ${JSON.stringify(json)}`
      );
      return json;
    },
  },
  {
    name: "POST /multipart-limit — multipart obeys total maxBodySize",
    run: async (baseUrl, adapterName) => {
      const form = new FormData();
      form.append("file", new Blob(["x".repeat(128)], { type: "text/plain" }), "large.txt");

      const res = await fetch(`${baseUrl}/multipart-limit`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

      const json = await res.json();
      assert(res.status === 413, `${adapterName} multipart total body limit expected 413, got ${res.status}`);
      assert(
        json.code === 413 || json.error === "Payload Too Large" || json.message === "Payload Too Large",
        `${adapterName} multipart total body limit returned unexpected payload: ${JSON.stringify(json)}`
      );
      return json;
    },
  },
];

// ── 测试单个 adapter ──────────────────────────────────

async function testAdapter(adapterName, port) {
  const header = `┌─ ${adapterName.toUpperCase()} Adapter (port ${port})`;
  console.log(`\n${header}`);
  console.log("│");

  let tmpDir;
  let bootstrapResult;

  try {
    // 1. 创建临时项目
    console.log("│ 📁 创建临时测试项目...");
    tmpDir = setupTempProject(adapterName, port);
    console.log(`│    → ${tmpDir}`);

    // 2. 动态导入 bootstrap（Windows 需要 file:// URL）
    console.log("│ 🚀 启动服务（bootstrap）...");
    const indexPath = pathToFileURL(join(ROOT, "dist", "index.js")).href;
    const { bootstrap } = await import(indexPath);
    bootstrapResult = await bootstrap(tmpDir);
    const { app, serverHandle } = bootstrapResult;

    console.log(
      `│    → 启动成功: http://${serverHandle.host}:${serverHandle.port}`,
    );
    console.log(`│    → adapter.name = "${app.adapter.name}"`);

    // 等一小段时间确保服务完全就绪
    await sleep(200);

    // 3. 运行测试用例
    const baseUrl = `http://127.0.0.1:${port}`;
    let passed = 0;
    let failed = 0;

    for (const tc of TEST_CASES) {
      try {
        await tc.run(baseUrl, adapterName);
        console.log(`│ ✅ ${tc.name}`);
        passed++;
      } catch (err) {
        console.log(`│ ❌ ${tc.name}`);
        console.log(`│    错误: ${err.message}`);
        failed++;
      }
    }

    // 4. 关闭服务
    console.log("│");
    console.log("│ 🔌 关闭服务...");
    await serverHandle.close();
    await sleep(SHUTDOWN_WAIT);
    console.log("│    → 已关闭");

    // 5. 汇总
    console.log("│");
    console.log(
      `│ 📊 结果: ${passed}/${TEST_CASES.length} 通过${failed > 0 ? `，${failed} 失败` : ""}`,
    );
    console.log(
      `└─ ${failed === 0 ? "✅ PASS" : "❌ FAIL"} — ${adapterName.toUpperCase()}`,
    );

    return { adapter: adapterName, passed, failed, total: TEST_CASES.length };
  } catch (err) {
    console.log(`│ 💥 启动或运行过程中出错:`);
    console.log(`│    ${err.message}`);
    if (err.stack) {
      const stackLines = err.stack.split("\n").slice(1, 4);
      for (const line of stackLines) {
        console.log(`│    ${line.trim()}`);
      }
    }

    // 尝试关闭
    if (bootstrapResult?.serverHandle) {
      try {
        await bootstrapResult.serverHandle.close();
      } catch {
        // ignore
      }
    }

    console.log(`└─ ❌ FAIL — ${adapterName.toUpperCase()} (启动失败)`);
    return {
      adapter: adapterName,
      passed: 0,
      failed: TEST_CASES.length,
      total: TEST_CASES.length,
      error: err.message,
    };
  } finally {
    // 清理临时目录
    if (tmpDir && existsSync(tmpDir)) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Windows 有时会锁文件，忽略
      }
    }
  }
}

// ── 入口 ──────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" VextJS Adapter 启动验证");
  console.log(` 测试 adapter: ${selectedAdapters.join(", ")}`);
  console.log(` 每个 adapter 测试 ${TEST_CASES.length} 个用例`);
  console.log("═══════════════════════════════════════════════════════════");

  const results = [];

  for (let i = 0; i < selectedAdapters.length; i++) {
    const name = selectedAdapters[i];
    const port = BASE_PORT + i;
    const result = await testAdapter(name, port);
    results.push(result);
  }

  // ── 汇总报告 ──────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(" 汇总报告");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const totalTests = results.reduce((s, r) => s + r.total, 0);

  for (const r of results) {
    const icon = r.failed === 0 ? "✅" : "❌";
    const detail = r.error ? ` (错误: ${r.error})` : "";
    console.log(
      `  ${icon} ${r.adapter.padEnd(10)} ${r.passed}/${r.total} 通过${detail}`,
    );
  }

  console.log("");
  console.log(`  总计: ${totalPassed}/${totalTests} 通过，${totalFailed} 失败`);

  const allPassed = totalFailed === 0;
  console.log("");
  console.log(allPassed ? "🎉 全部通过！" : "⚠️  存在失败项，请检查上方日志。");
  console.log("═══════════════════════════════════════════════════════════");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("💥 脚本执行失败:", err);
  process.exit(1);
});
