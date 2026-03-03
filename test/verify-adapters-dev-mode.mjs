/**
 * Adapter 开发模式验证脚本
 *
 * 验证 Hono / Fastify / Express / Koa 四个 adapter 在 dev 模式下能否正常：
 *   1. 通过 devBootstrap 启动（开发模式）
 *   2. 响应 GET / 请求（返回正确的 JSON 格式）
 *   3. 响应 GET /health 请求
 *   4. 路径参数解析
 *   5. POST body 解析
 *   6. 404 处理
 *   7. 优雅关闭
 *
 * 用法：
 *   node test/verify-adapters-dev-mode.mjs
 *   node test/verify-adapters-dev-mode.mjs hono
 *   node test/verify-adapters-dev-mode.mjs fastify koa
 *
 * 注意：
 *   - 需要先 npm run build（使用 dist/ 中的 devBootstrap）
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

const ADAPTERS = ["hono", "fastify", "express", "koa"];
const BASE_PORT = 18800;
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
 * 创建临时测试项目目录（含 TypeScript 源文件，供 devBootstrap 编译）
 */
function setupTempProject(adapterName, port) {
  const tmpDir = join(ROOT, `test/.tmp-verify-dev-${adapterName}`);

  // 清理旧目录
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // 创建目录结构
  mkdirSync(join(tmpDir, "src", "config"), { recursive: true });
  mkdirSync(join(tmpDir, "src", "routes"), { recursive: true });

  // 写入 tsconfig.json（devBootstrap 需要读取）
  writeFileSync(
    join(tmpDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "./dist",
          rootDir: "./src",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          declaration: true,
        },
        include: ["src/**/*"],
      },
      null,
      2,
    ),
  );

  // 写入配置文件（.ts 格式供 dev 编译）
  writeFileSync(
    join(tmpDir, "src", "config", "default.ts"),
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
};
`,
  );

  // 写入路由文件（.ts 格式）
  writeFileSync(
    join(tmpDir, "src", "routes", "index.ts"),
    `import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req: any, res: any) => {
    res.json({ message: "dev hello from ${adapterName}" });
  });

  app.get("/health", {}, async (_req: any, res: any) => {
    res.json({ status: "ok", adapter: "${adapterName}", mode: "dev" });
  });

  app.get("/echo/:name", {}, async (req: any, res: any) => {
    const name = req.params.name;
    res.json({ echo: name, adapter: "${adapterName}" });
  });

  app.post("/body-test", {}, async (req: any, res: any) => {
    const body = req.body;
    res.json({ received: body, adapter: "${adapterName}" });
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
      throw e2;
    }
  }

  return tmpDir;
}

// ── 测试用例 ──────────────────────────────────────────

const TEST_CASES = [
  {
    name: "GET / — 基础路由 (dev mode)",
    run: async (baseUrl, adapterName) => {
      const res = await fetch(`${baseUrl}/`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      const json = await res.json();
      assert(res.status === 200, `期望 200，实际 ${res.status}`);
      assert(json.code === 0, `期望 code=0，实际 code=${json.code}`);
      assert(
        json.data?.message === `dev hello from ${adapterName}`,
        `期望 message="dev hello from ${adapterName}"，实际 ${JSON.stringify(json.data?.message)}`,
      );
      assert(
        typeof json.requestId === "string" && json.requestId.length > 0,
        `期望 requestId 为非空字符串，实际 ${JSON.stringify(json.requestId)}`,
      );
      return json;
    },
  },
  {
    name: "GET /health — 健康检查 (dev mode)",
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
      assert(
        json.data?.mode === "dev",
        `期望 mode="dev"，实际 ${JSON.stringify(json.data?.mode)}`,
      );
      return json;
    },
  },
  {
    name: "GET /echo/:name — 路径参数 (dev mode)",
    run: async (baseUrl, adapterName) => {
      const res = await fetch(`${baseUrl}/echo/devworld`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      const json = await res.json();
      assert(res.status === 200, `期望 200，实际 ${res.status}`);
      assert(
        json.data?.echo === "devworld",
        `期望 echo="devworld"，实际 ${JSON.stringify(json.data?.echo)}`,
      );
      assert(
        json.data?.adapter === adapterName,
        `期望 adapter="${adapterName}"，实际 ${JSON.stringify(json.data?.adapter)}`,
      );
      return json;
    },
  },
  {
    name: "POST /body-test — JSON Body 解析 (dev mode)",
    run: async (baseUrl, adapterName) => {
      const payload = { foo: "bar", num: 42, dev: true };
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
      assert(
        json.data?.received?.dev === true,
        `期望 received.dev=true，实际 ${JSON.stringify(json.data?.received?.dev)}`,
      );
      return json;
    },
  },
  {
    name: "GET /nonexistent — 404 处理 (dev mode)",
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
    name: "Content-Type + x-request-id 响应头检查 (dev mode)",
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
    name: "请求唯一性 — requestId 不重复 (dev mode)",
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
];

// ── 测试单个 adapter (dev mode) ───────────────────────

async function testAdapter(adapterName, port) {
  const header = `┌─ ${adapterName.toUpperCase()} Adapter — DEV MODE (port ${port})`;
  console.log(`\n${header}`);
  console.log("│");

  let tmpDir;
  let devResult;

  try {
    // 1. 创建临时项目
    console.log("│ 📁 创建临时测试项目...");
    tmpDir = setupTempProject(adapterName, port);
    console.log(`│    → ${tmpDir}`);

    // 2. 动态导入 devBootstrap（Windows 需要 file:// URL）
    console.log("│ 🚀 启动服务（devBootstrap）...");

    const devBootstrapPath = pathToFileURL(
      join(ROOT, "dist", "lib", "dev", "dev-bootstrap.js"),
    ).href;
    const { devBootstrap } = await import(devBootstrapPath);

    devResult = await devBootstrap({
      projectRoot: tmpDir,
      skipIpc: true, // 非 fork 场景，禁用 IPC
    });

    const { app, serverHandle } = devResult;
    const actualPort = serverHandle?.port ?? port;
    const actualHost = serverHandle?.host ?? "127.0.0.1";

    console.log(`│    → 启动成功: http://${actualHost}:${actualPort}`);
    console.log(`│    → adapter.name = "${app.adapter.name}"`);
    console.log(`│    → mode = dev`);

    // 等一小段时间确保服务完全就绪
    await sleep(300);

    // 3. 运行测试用例
    const baseUrl = `http://127.0.0.1:${actualPort}`;
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

    if (devResult.serverHandle?.close) {
      await devResult.serverHandle.close();
    }

    await sleep(SHUTDOWN_WAIT);
    console.log("│    → 已关闭");

    // 5. 汇总
    console.log("│");
    console.log(
      `│ 📊 结果: ${passed}/${TEST_CASES.length} 通过${failed > 0 ? `，${failed} 失败` : ""}`,
    );
    console.log(
      `└─ ${failed === 0 ? "✅ PASS" : "❌ FAIL"} — ${adapterName.toUpperCase()} (DEV MODE)`,
    );

    return { adapter: adapterName, passed, failed, total: TEST_CASES.length };
  } catch (err) {
    console.log(`│ 💥 启动或运行过程中出错:`);
    console.log(`│    ${err.message}`);
    if (err.stack) {
      const stackLines = err.stack.split("\n").slice(1, 6);
      for (const line of stackLines) {
        console.log(`│    ${line.trim()}`);
      }
    }

    // 尝试关闭
    if (devResult?.serverHandle?.close) {
      try {
        await devResult.serverHandle.close();
      } catch {
        // ignore
      }
    }

    console.log(
      `└─ ❌ FAIL — ${adapterName.toUpperCase()} (DEV MODE — 启动失败)`,
    );
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
  console.log(" VextJS Adapter 开发模式（devBootstrap）启动验证");
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
  console.log(" 汇总报告（DEV MODE）");
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
  console.log(
    allPassed ? "🎉 DEV MODE 全部通过！" : "⚠️  存在失败项，请检查上方日志。",
  );
  console.log("═══════════════════════════════════════════════════════════");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("💥 脚本执行失败:", err);
  process.exit(1);
});
