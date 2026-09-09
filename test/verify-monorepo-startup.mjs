import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

// 可指向同一 tarball 已安装的包根；只消费 package.json 和 dist，禁止源码重定向。
const packageRoot = resolve(
  process.env.VEXT_MONOREPO_PACKAGE_ROOT ||
    join(dirname(fileURLToPath(import.meta.url)), ".."),
);
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
assert.ok(
  existsSync(join(packageRoot, "dist/cli/index.js")),
  "Run npm run build first",
);
const evidence = [];
const workspace = mkdtempSync(join(tmpdir(), "vext-monorepo-runtime-"));

function write(root, relative, content) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}
function link(target, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  symlinkSync(
    target,
    destination,
    process.platform === "win32" ? "junction" : "dir",
  );
}
async function command(entry, args, cwd, expectedCode = 0) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (value) => {
    output += value;
  });
  child.stderr.on("data", (value) => {
    output += value;
  });
  const timer = setTimeout(() => child.kill(), 40_000);
  try {
    const code = await new Promise((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    assert.equal(code, expectedCode, output);
    return output;
  } finally {
    clearTimeout(timer);
  }
}
async function portReleased(port) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(done));
  });
}

async function allocatePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

try {
  for (const [layout, mode, language, cluster, customOutput] of [
    ["hoisted", "start", "js", false],
    ["pnpm", "start", "ts", false],
    ["hoisted", "dev", "ts", false],
    ["pnpm", "dev", "js", false],
    ["hoisted", "start", "js", true],
    ["pnpm", "start", "ts", false, "build/api"],
    ["hoisted", "start", "ts", true, "release/server"],
  ]) {
    const name = `${layout}-${mode}-${language}${cluster ? "-cluster" : ""}${customOutput ? "-custom" : ""}`;
    const root = join(workspace, name);
    const service = join(root, "apps/api");
    const packageDir =
      layout === "pnpm"
        ? join(
            root,
            "node_modules/.pnpm",
            `vextjs@${pkg.version}`,
            "node_modules/vextjs",
          )
        : join(root, "node_modules/vextjs");
    mkdirSync(packageDir, { recursive: true });
    cpSync(join(packageRoot, "dist"), join(packageDir, "dist"), {
      recursive: true,
    });
    cpSync(join(packageRoot, "package.json"), join(packageDir, "package.json"));
    // 依赖来自实际安装；被测 vextjs 是隔离的编译产物副本。
    for (const dependency of new Set([
      ...Object.keys(pkg.dependencies),
      "typescript",
      "@types/node",
    ])) {
      const { createRequire } = await import("node:module");
      const require = createRequire(join(packageRoot, "package.json"));
      const search = require.resolve.paths(dependency) || [];
      const target = search
        .map((base) => join(base, dependency))
        .find((candidate) => existsSync(join(candidate, "package.json")));
      assert.ok(target, `Missing installed dependency ${dependency}`);
      link(target, join(root, "node_modules", dependency));
    }
    if (layout === "pnpm")
      link(packageDir, join(service, "node_modules/vextjs"));
    write(
      service,
      "package.json",
      JSON.stringify({
        name: "api",
        type: "module",
        dependencies: { vextjs: pkg.version, telemetry: "1.0.0" },
        devDependencies: { typescript: "*" },
      }),
    );
    const preload = join(root, "node_modules/telemetry");
    write(
      preload,
      "package.json",
      JSON.stringify({
        name: "telemetry",
        exports: { "./setup": "./setup.mjs" },
        vext: { preload: "./setup.mjs" },
      }),
    );
    write(
      preload,
      "setup.mjs",
      `process.env.VEXT_MONOREPO_PROBE = ${JSON.stringify(name)};`,
    );
    const assignedPort = await allocatePort();
    write(
      service,
      `src/config/default.${language}`,
      `export default { adapter: "native", port: ${assignedPort}, host: "127.0.0.1", openapi: { enabled: false }, logger: { level: "warn" }, cluster: { enabled: ${cluster}, workers: 2 }, shutdown: { timeout: 2 }, requestId: { enabled: false }, locale: { default: "en-US", supported: ["en-US", "zh-CN"] }, fetch: { propagateHeaders: ["x-tenant-id"] } };`,
    );
    write(
      service,
      `src/routes/index.${language}`,
      'import { defineRoutes, requestContext } from "vextjs"; export default defineRoutes(app => { app.get("/", {}, (req, res) => { res.json({ preload: process.env.VEXT_MONOREPO_PROBE, locale: requestContext.getStore()?.locale, tenant: requestContext.getStore()?.propagatedHeaders?.["x-tenant-id"], requestId: req.requestId }); }); });',
    );
    if (language === "ts")
      write(
        service,
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            skipLibCheck: true,
            noEmit: true,
          },
          include: ["src/**/*.ts", ".vext/types/**/*.ts"],
        }),
      );
    else
      write(
        service,
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            allowJs: true,
            checkJs: true,
            noEmit: true,
            module: "NodeNext",
            moduleResolution: "NodeNext",
            skipLibCheck: true,
          },
          include: ["src/**/*.js"],
        }),
      );
    const cli = join(packageDir, "dist/cli/index.js");
    if (language === "ts" && mode === "start") {
      if (customOutput) {
        write(
          service,
          "src/preload/project.ts",
          'process.env.VEXT_PROJECT_PRELOAD_PROBE = "compiled";',
        );
        write(service, "src/config/staging.ts", "export default {};");
      }
      await command(
        cli,
        [
          "build",
          ...(customOutput
            ? ["--outdir", customOutput, "--config", "staging"]
            : []),
        ],
        service,
      );
      if (customOutput) {
        const locationPath = join(service, ".vext/build-location.json");
        const first = JSON.parse(readFileSync(locationPath, "utf8"));
        assert.equal(first.outDir, customOutput);
        write(
          service,
          `${customOutput}/stale.txt`,
          "remove me through recorded --clean",
        );
        await command(
          cli,
          ["build", "--clean", "--config", "staging"],
          service,
        );
        assert.equal(
          existsSync(join(service, customOutput, "stale.txt")),
          false,
        );
        const routePath = join(service, "src/routes/index.ts");
        const route = readFileSync(routePath, "utf8");
        writeFileSync(routePath, "invalid syntax !!!");
        await command(cli, ["build"], service, 1);
        assert.match(
          await command(cli, ["start"], service, 1),
          /identity|incomplete/,
        );
        writeFileSync(
          routePath,
          route.replace(
            "preload: process.env.VEXT_MONOREPO_PROBE",
            "preload: process.env.VEXT_MONOREPO_PROBE, projectPreload: process.env.VEXT_PROJECT_PRELOAD_PROBE, profile: process.env.VEXT_CONFIG",
          ),
        );
        await command(cli, ["build", "--config", "staging"], service);
        // 编译后改动源 preload：start/cluster 必须仍消费同一份编译产物。
        write(
          service,
          "src/preload/project.ts",
          'throw new Error("unbuilt source preload was executed");',
        );
        if (cluster) {
          // 源码目录由本 fixture 创建；验证教程所述仅携带生产产物的部署。
          rmSync(join(service, "src"), { recursive: true });
        }
      }
    }
    // 将测试控制消息交给 CLI 自己的 shutdown handler，Windows 也走真实优雅关闭链。
    const control = write(
      root,
      "control.mjs",
      'process.on("message", message => { if (message?.type === "test-stop") process.emit("SIGTERM"); });',
    );
    const child = fork(
      cli,
      [mode, ...(mode === "dev" ? ["--strict-preflight"] : [])],
      {
        cwd: service,
        execArgv: ["--import", pathToFileURL(control).href],
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let output = "";
    let port = assignedPort;
    let exited = false;
    const closed = new Promise((done) =>
      child.once("exit", () => {
        exited = true;
        done();
      }),
    );
    child.stdout.on("data", (value) => {
      output += value;
    });
    child.stderr.on("data", (value) => {
      output += value;
    });
    evidence.push({
      name,
      command: [process.execPath, cli, mode],
      cwd: service,
      pid: child.pid,
      port: null,
      passed: false,
      stopped: false,
    });
    try {
      const deadline = Date.now() + 40_000;
      while (Date.now() < deadline) {
        assert.equal(exited, false, output);
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          port = Number(match[1]);
          break;
        }
        await sleep(100);
      }
      assert.match(
        output,
        /http:\/\/127\.0\.0\.1:\d+/,
        `No ready URL: ${output}`,
      );
      evidence.at(-1).port = port;
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(5000),
        headers: {
          "accept-language": "zh-CN",
          "x-tenant-id": "tenant-runtime",
        },
      });
      assert.equal(response.status, 200, output);
      const body = await response.json();
      assert.equal(body.data.preload, name);
      assert.equal(body.data.locale, "zh-CN");
      assert.equal(body.data.tenant, "tenant-runtime");
      assert.equal(body.data.requestId, "");
      assert.equal(response.headers.get("x-request-id"), null);
      if (customOutput) {
        assert.equal(body.data.projectPreload, "compiled");
        assert.equal(body.data.profile, "staging");
      }
      if (mode === "dev") {
        const route = join(service, `src/routes/index.${language}`);
        writeFileSync(
          route,
          readFileSync(route, "utf8").replace(
            "res.json({",
            'res.json({ reloadProbe: "updated",',
          ),
        );
        let reloaded = false;
        const reloadDeadline = Date.now() + 15_000;
        while (Date.now() < reloadDeadline) {
          const result = await fetch(`http://127.0.0.1:${port}/`, {
            signal: AbortSignal.timeout(3000),
            headers: {
              "accept-language": "zh-CN",
              "x-tenant-id": "after-reload",
            },
          });
          const payload = await result.json();
          if (payload.data?.reloadProbe === "updated") {
            assert.equal(payload.data.locale, "zh-CN");
            assert.equal(payload.data.tenant, "after-reload");
            assert.equal(result.headers.get("x-request-id"), null);
            reloaded = true;
            break;
          }
          await sleep(100);
        }
        assert.ok(reloaded, `Soft reload did not update the route: ${output}`);
        evidence.at(-1).softReload = true;
      }
      evidence.at(-1).passed = true;
    } finally {
      if (!exited && child.connected) child.send({ type: "test-stop" });
      const stopped = await Promise.race([
        closed.then(() => true),
        sleep(12_000, false, { ref: false }),
      ]);
      if (!stopped) {
        // 仅回收本脚本记录的进程树；正常验证必须走上方优雅关闭。
        if (process.platform === "win32") {
          await new Promise((done) =>
            spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
              windowsHide: true,
              stdio: "ignore",
            }).once("close", done),
          );
        } else {
          child.kill("SIGTERM");
        }
      }
      if (port) await portReleased(port);
      evidence.at(-1).stopped = stopped;
      assert.ok(stopped, `CLI failed to stop gracefully: ${output}`);
    }
    console.log(`PASS ${name}`);
  }
  console.log(
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      packageRoot,
      packageVersion: pkg.version,
      evidence,
    }),
  );
} finally {
  if (process.env.VEXT_MONOREPO_EVIDENCE)
    writeFileSync(
      resolve(process.env.VEXT_MONOREPO_EVIDENCE),
      JSON.stringify({ workspace, evidence }, null, 2),
    );
  // workspace 来自本脚本的 mkdtemp，未从项目配置推导。
  rmSync(workspace, { recursive: true, force: true });
}
