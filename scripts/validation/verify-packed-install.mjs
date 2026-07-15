#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const workspace = path.resolve(
  process.env.VEXT_PREFLIGHT_WORKSPACE ??
    path.join(root, "test", `.tmp-release-preflight-${runId}`),
);
const artifacts = path.join(workspace, "artifacts");
const consumer = path.join(workspace, "consumer");

mkdirSync(artifacts, { recursive: true });
mkdirSync(consumer, { recursive: true });

function npm(args, options = {}) {
  const result = spawnSync("npm", args, {
    cwd: options.cwd ?? root,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout ?? "";
}

function pack(target) {
  const output = npm(
    [
      "pack",
      target,
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      artifacts,
    ],
    { capture: true },
  );
  const manifest = JSON.parse(output)[0];
  if (!manifest?.filename)
    throw new Error(`npm pack did not return a filename for ${target}`);
  console.log(`${manifest.name}@${manifest.version}: ${manifest.filename}`);
  return path.join(artifacts, manifest.filename);
}

const schemaTarball = pack(path.join(root, "node_modules", "schema-dsl"));
const monsqlizeTarball = pack(path.join(root, "node_modules", "monsqlize"));
const vextTarball = pack(root);
const vextSha256 = createHash("sha256")
  .update(readFileSync(vextTarball))
  .digest("hex");
const expectedSha256 = process.env.VEXT_EXPECTED_ARTIFACT_SHA256?.toLowerCase();
if (expectedSha256 && vextSha256 !== expectedSha256) {
  throw new Error(
    `Packed vextjs SHA256 ${vextSha256} does not match external validation ${expectedSha256}`,
  );
}
console.log(`vextjs tarball SHA256: ${vextSha256}`);

writeFileSync(
  path.join(consumer, "package.json"),
  `${JSON.stringify({ name: "vext-packed-install-smoke", private: true, type: "module" }, null, 2)}\n`,
);

npm(
  [
    "install",
    "--ignore-scripts",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
    schemaTarball,
    monsqlizeTarball,
    vextTarball,
  ],
  { cwd: consumer },
);
npm(["ls", "vextjs", "monsqlize", "schema-dsl", "--all"], { cwd: consumer });

const esmSmoke = [
  "if (Object.getOwnPropertyDescriptor(String.prototype, 'description')) throw new Error('pre-import String pollution');",
  "const vext = await import('vextjs');",
  "await import('monsqlize');",
  "await import('schema-dsl');",
  "if (Object.getOwnPropertyDescriptor(String.prototype, 'description')) throw new Error('post-import String pollution');",
  "const schema = vext.schemaAdapter.compile({ name: 'string!', nickname: 'string?' });",
  "if (!schema.required?.includes('name') || schema.required?.includes('nickname')) throw new Error('required projection mismatch');",
  "console.log('ESM packed smoke passed');",
].join(" ");

const cjsSmoke = [
  "if (Object.getOwnPropertyDescriptor(String.prototype, 'description')) throw new Error('pre-import String pollution');",
  "const vext = require('vextjs');",
  "if (Object.getOwnPropertyDescriptor(String.prototype, 'description')) throw new Error('post-import String pollution');",
  "if (typeof vext.schemaAdapter?.compile !== 'function') throw new Error('schemaAdapter export missing');",
  "console.log('CJS packed smoke passed');",
].join(" ");

for (const args of [
  ["--input-type=module", "-e", esmSmoke],
  ["-e", cjsSmoke],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: consumer,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Packed install verified for vextjs@${pkg.version}`);
console.log(`Evidence workspace retained at: ${workspace}`);
