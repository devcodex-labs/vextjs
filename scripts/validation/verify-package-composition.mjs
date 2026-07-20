#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "../..");
const docsDeclarationPath = "dist/lib/docs/renderers/vext-assets.d.ts";
const requiredRootFiles = [
  "package.json",
  "README.md",
  "MIGRATION.md",
  "CHANGELOG.md",
  "LICENSE",
];
const forbiddenPrefixes = [
  "scripts/",
  "src/",
  "test/",
  "website/",
  "examples/",
  ".github/",
  "node_modules/",
  ".vext/",
];

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function collectStringTargets(value, targets = []) {
  if (typeof value === "string") {
    targets.push(normalizePath(value));
    return targets;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      collectStringTargets(child, targets);
    }
  }
  return targets;
}

function packageNamesFromInput(inputPath) {
  const normalized = normalizePath(inputPath);
  const names = [];
  const pattern = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/g;
  let match;
  while ((match = pattern.exec(normalized))) {
    if (match[1] !== ".pnpm") names.push(match[1]);
  }
  return names;
}

export function runtimeDependencyNames(pkg) {
  return [
    ...new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      "mongodb-memory-server-core",
    ]),
  ].sort();
}

export function assertNoBundledRuntimeDependencies(
  metafile,
  runtimePackages,
  label = "CJS bundle",
) {
  if (!metafile?.inputs || typeof metafile.inputs !== "object") {
    throw new TypeError(`${label} is missing an esbuild metafile input map`);
  }

  const runtimeSet = new Set(runtimePackages);
  const bundled = new Set();
  for (const inputPath of Object.keys(metafile.inputs)) {
    for (const packageName of packageNamesFromInput(inputPath)) {
      if (runtimeSet.has(packageName)) bundled.add(packageName);
    }
  }

  if (bundled.size > 0) {
    throw new Error(
      `${label} bundled runtime dependencies: ${[...bundled].sort().join(", ")}`,
    );
  }

  return {
    bundledRuntimePackages: [],
    checkedInputs: Object.keys(metafile.inputs).length,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runPackDryRun() {
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `npm pack --dry-run failed (${result.status}): ${result.stderr.trim()}`,
    );
  }

  const payload = JSON.parse(result.stdout);
  assert(
    Array.isArray(payload) && payload.length === 1,
    "npm pack --dry-run must return exactly one package manifest",
  );
  return payload[0];
}

function regionBytes(files, predicate) {
  return files.reduce(
    (total, file) => total + (predicate(file.path) ? file.size : 0),
    0,
  );
}

export function verifyPackageComposition() {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const pack = runPackDryRun();
  const files = (pack.files ?? []).map((file) => ({
    ...file,
    path: normalizePath(file.path),
  }));
  const inventory = new Set(files.map((file) => file.path));
  const exportTargets = [
    ...new Set(
      collectStringTargets(pkg.exports).map((target) =>
        target.replace(/^\.\//, ""),
      ),
    ),
  ].sort();
  const binTargets = [
    ...new Set(
      collectStringTargets(pkg.bin).map((target) =>
        target.replace(/^\.\//, ""),
      ),
    ),
  ].sort();

  assert(
    exportTargets.length === 27,
    `expected 27 package export targets, found ${exportTargets.length}`,
  );
  assert(
    binTargets.length === 1,
    `expected one CLI bin target, found ${binTargets.length}`,
  );

  for (const requiredPath of [
    ...requiredRootFiles,
    ...exportTargets,
    ...binTargets,
  ]) {
    assert(
      inventory.has(requiredPath),
      `required package path is missing: ${requiredPath}`,
    );
  }

  for (const filePath of inventory) {
    const forbidden = forbiddenPrefixes.find((prefix) =>
      filePath.startsWith(prefix),
    );
    assert(
      !forbidden,
      `forbidden package path ${filePath} matched ${forbidden}`,
    );
  }

  const declarationFile = path.join(root, docsDeclarationPath);
  const declaration = readFileSync(declarationFile, "utf8");
  const declarationBytes = statSync(declarationFile).size;
  assert(
    declarationBytes < 1024,
    `${docsDeclarationPath} must be smaller than 1 KiB`,
  );
  assert(
    /export declare const VEXT_DOCS_STYLE_CSS: string;/.test(declaration),
    "VEXT_DOCS_STYLE_CSS must emit a string declaration",
  );
  assert(
    /export declare const VEXT_DOCS_APP_JS: string;/.test(declaration),
    "VEXT_DOCS_APP_JS must emit a string declaration",
  );
  assert(
    !declaration.includes("color-scheme"),
    "Docs CSS leaked into the declaration file",
  );
  assert(
    !declaration.includes("document.getElementById"),
    "Docs JavaScript leaked into the declaration file",
  );

  const summary = {
    package: `${pack.name}@${pack.version}`,
    entryCount: files.length,
    tarballBytes: pack.size,
    unpackedBytes: pack.unpackedSize,
    exportTargetCount: exportTargets.length,
    binTargetCount: binTargets.length,
    docsDeclarationBytes: declarationBytes,
    regions: {
      dist: regionBytes(files, (file) => file.startsWith("dist/")),
      cjs: regionBytes(files, (file) => file.endsWith(".cjs")),
      declarations: regionBytes(files, (file) => file.endsWith(".d.ts")),
      scripts: regionBytes(files, (file) => file.startsWith("scripts/")),
      rootMetadata: regionBytes(files, (file) =>
        requiredRootFiles.includes(file),
      ),
    },
  };

  assert(
    summary.entryCount === pack.entryCount,
    "npm pack entry count is inconsistent",
  );
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    verifyPackageComposition();
  } catch (error) {
    console.error(`Package composition verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
