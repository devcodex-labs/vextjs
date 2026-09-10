import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveValidationCommand } from "../scripts/validation/resolve-command.mjs";

// 真实包管理器安装；不手工拼接node_modules，不把仓库源码当成已安装消费者。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manager = process.argv[2] ?? "npm";
assert.ok(["npm", "pnpm"].includes(manager), "Expected npm or pnpm");
const workspace = process.env.VEXT_INSTALLED_WORKSPACE
  ? path.resolve(process.env.VEXT_INSTALLED_WORKSPACE)
  : mkdtempSync(path.join(tmpdir(), `vext-installed-${manager}-`));
const artifacts = path.join(workspace, "artifacts");
mkdirSync(artifacts, { recursive: true });
const records = [];
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
function write(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
  );
}
function command(tool, args, cwd) {
  return new Promise((resolve, reject) => {
    const invocation = resolveValidationCommand(
      tool === "node" ? process.execPath : tool,
      args,
    );
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const timeout = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        const cleanup = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        cleanup.once("error", () => child.kill());
      } else child.kill();
    }, 600_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      records.push({ tool, args, cwd, code, stdout, stderr });
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(`${tool} ${args[0]} exited ${code}\n${stdout}\n${stderr}`),
        );
    });
  });
}
async function pack(directory) {
  const result = JSON.parse(
    await command(
      "npm",
      [
        "pack",
        directory,
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        artifacts,
      ],
      root,
    ),
  )[0];
  return path.join(artifacts, result.filename);
}

try {
  assert.ok(
    existsSync(path.join(root, "dist/lib/consumer-resolver.js")),
    "Run npm run build first",
  );
  const tarball = process.env.VEXT_INSTALLED_TARBALL
    ? path.resolve(process.env.VEXT_INSTALLED_TARBALL)
    : await pack(root);
  const candidateVersion = json(path.join(root, "package.json")).version;
  const probes = [];
  for (const major of [1, 2]) {
    const directory = path.join(workspace, `probe-${major}`);
    write(path.join(directory, "package.json"), {
      name: "@vext-fixture/probe",
      version: `${major}.0.0`,
      type: "module",
      exports: {
        ".": {
          types: "./index.d.ts",
          import: "./index.js",
          require: "./index.cjs",
        },
      },
    });
    write(
      path.join(directory, "index.js"),
      `export const version = ${major};\n`,
    );
    write(
      path.join(directory, "index.cjs"),
      `exports.version = ${major + 10};\n`,
    );
    write(
      path.join(directory, "index.d.ts"),
      `export declare const version: ${major};\n`,
    );
    probes.push(await pack(directory));
  }
  const installation = path.join(workspace, "installed");
  write(path.join(installation, "package.json"), {
    name: "installed-workspace",
    private: true,
    workspaces: ["apps/*", "packages/*"],
  });
  write(
    path.join(installation, "pnpm-workspace.yaml"),
    "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
  );
  const shared = path.join(installation, "packages/contracts");
  write(path.join(shared, "package.json"), {
    name: "@vext-fixture/contracts",
    version: "1.0.0",
    type: "module",
    exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
  });
  write(
    path.join(shared, "index.js"),
    'export const fields = { name: "string!" };\n',
  );
  write(
    path.join(shared, "index.d.ts"),
    'export declare const fields: { name: "string!" };\n',
  );
  const services = [
    path.join(installation, "apps/current"),
    path.join(installation, "apps/previous"),
  ];
  for (const [index, service] of services.entries()) {
    write(path.join(service, "package.json"), {
      name: `service-${index}`,
      private: true,
      type: "module",
      dependencies: {
        vextjs: index === 0 ? `file:${tarball.replaceAll("\\", "/")}` : "1.0.2",
        "@vext-fixture/probe": `file:${probes[index].replaceAll("\\", "/")}`,
        "@vext-fixture/contracts": manager === "pnpm" ? "workspace:*" : "*",
      },
      devDependencies: { typescript: "5.9.3", "@types/node": "22.19.13" },
    });
    write(
      path.join(service, "type-contract.mts"),
      `import { version } from "@vext-fixture/probe"; import { fields } from "@vext-fixture/contracts"; const exact: ${index + 1} = version; const rule: "string!" = fields.name; void exact; void rule;\n`,
    );
    write(path.join(service, "tsconfig.json"), {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      files: ["type-contract.mts"],
    });
  }
  console.log(
    JSON.stringify({ phase: "install", manager, workspace, tarball }),
  );
  await command(
    manager,
    manager === "npm"
      ? ["install", "--ignore-scripts", "--no-audit", "--no-fund"]
      : ["install", "--ignore-scripts", "--reporter=append-only"],
    installation,
  );
  const currentRequire = createRequire(path.join(services[0], "package.json"));
  const findPackage = (service, name) => {
    const require = createRequire(path.join(service, "package.json"));
    return require.resolve
      .paths(name)
      .map((base) => path.join(base, name))
      .find((directory) => existsSync(path.join(directory, "package.json")));
  };
  const candidateRoot = realpathSync(findPackage(services[0], "vextjs"));
  const resolver = await import(
    pathToFileURL(path.join(candidateRoot, "dist/lib/consumer-resolver.js"))
      .href
  );
  const resolved = [];
  for (const [index, service] of services.entries()) {
    const framework = resolver.resolveConsumerPackage(service, "vextjs");
    assert.equal(
      framework.manifest.version,
      index === 0 ? candidateVersion : "1.0.2",
    );
    const probe = resolver.resolveConsumerPackage(
      service,
      "@vext-fixture/probe",
    );
    assert.equal(probe.manifest.version, `${index + 1}.0.0`);
    const require = createRequire(path.join(service, "package.json"));
    assert.throws(() => require.resolve("@vext-fixture/probe/package.json"), {
      code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
    const esm = await import(
      resolver.resolveConsumerModule(service, "@vext-fixture/probe")
    );
    assert.equal(esm.version, index + 1);
    assert.equal(require("@vext-fixture/probe").version, index + 11);
    assert.equal(
      (
        await import(
          resolver.resolveConsumerModule(service, "@vext-fixture/contracts")
        )
      ).fields.name,
      "string!",
    );
    const compiler = require.resolve("typescript/bin/tsc");
    await command(
      "node",
      [
        compiler,
        "--project",
        path.join(service, "tsconfig.json"),
        "--pretty",
        "false",
      ],
      service,
    );
    resolved.push({
      service,
      framework: framework.rootDir,
      frameworkVersion: framework.manifest.version,
      probe: probe.rootDir,
      declaration: path.join(probe.rootDir, "index.d.ts"),
    });
  }
  assert.notEqual(resolved[0].framework, resolved[1].framework);
  assert.notEqual(resolved[0].probe, resolved[1].probe);
  // 当前候选真实CLI和公开ESM/CJS入口；旧版只验证定位，不冒充当前版运行时矩阵。
  assert.equal(typeof currentRequire("vextjs").defineRoutes, "function");
  assert.equal(
    typeof (await import(resolver.resolveConsumerModule(services[0], "vextjs")))
      .defineRoutes,
    "function",
  );
  write(
    path.join(services[0], "src/config/default.js"),
    'export default { adapter: "native", openapi: { enabled: false }, logger: { level: "silent" } };\n',
  );
  write(
    path.join(services[0], "src/routes/index.js"),
    'import { defineRoutes } from "vextjs"; import { fields } from "@vext-fixture/contracts"; export default defineRoutes(app => { app.post("/", { validate: { body: fields }, docs: { summary: "Installed shared schema" } }, (req,res) => res.json(req.valid("body"))); });\n',
  );
  const cli = path.join(candidateRoot, "dist/cli/index.js");
  await command("node", [cli, "build"], services[0]);
  await command("node", [cli, "typegen"], services[0]);
  await command("node", [cli, "typegen", "--check"], services[0]);
  const tree = await command(
    manager,
    manager === "npm"
      ? ["ls", "--all", "--json"]
      : ["list", "-r", "--depth", "99", "--json"],
    installation,
  );
  write(path.join(workspace, "dependency-tree.json"), tree);
  write(path.join(workspace, "result.json"), {
    status: "PASS",
    manager,
    managerVersion: (await command(manager, ["--version"], root)).trim(),
    node: process.version,
    tarball,
    sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"),
    resolved,
    records,
  });
  console.log(JSON.stringify({ status: "PASS", manager, workspace, resolved }));
} catch (error) {
  write(path.join(workspace, "result.json"), {
    status: "FAIL",
    manager,
    error: String(error),
    records,
  });
  console.error(error);
  process.exitCode = 1;
}
