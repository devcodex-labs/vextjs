#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const readJson = (file) =>
  JSON.parse(readFileSync(path.join(root, file), "utf8"));
const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const failures = [];
const schemaAdapterDeclaration = readFileSync(
  path.join(root, "dist/lib/schema-adapter.d.ts"),
  "utf8",
);
const compatWorkflow = readFileSync(
  path.join(root, ".github/workflows/schema-dsl-compat.yml"),
  "utf8",
);

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function isExactVersion(value) {
  return (
    typeof value === "string" &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
  );
}

const expected = {
  "schema-dsl": pkg.dependencies?.["schema-dsl"],
  monsqlize: pkg.dependencies?.monsqlize,
};
const lockRoot = lock.packages?.[""];

assert(
  isExactVersion(expected["schema-dsl"]),
  "schema-dsl must use an exact version",
);
assert(expected["schema-dsl"]?.startsWith("3."), "schema-dsl must be on v3");
assert(
  isExactVersion(expected.monsqlize),
  "monsqlize must use an exact version",
);
assert(expected.monsqlize?.startsWith("3."), "monsqlize must be on v3+");
assert(
  lockRoot?.version === pkg.version,
  "package-lock root version must match package.json",
);
assert(
  lockRoot?.dependencies?.["schema-dsl"] === expected["schema-dsl"],
  "package-lock root schema-dsl spec must match package.json",
);
assert(
  lockRoot?.dependencies?.monsqlize === expected.monsqlize,
  "package-lock root monsqlize spec must match package.json",
);
assert(
  /declare function compile\(definition:\s*DslDefinition,/.test(
    schemaAdapterDeclaration,
  ),
  "schemaAdapter.compile must expose DslDefinition as its public object input",
);
assert(
  !/declare function compile\(definition:\s*Record<string,\s*DslDefinition>,/.test(
    schemaAdapterDeclaration,
  ),
  "schemaAdapter.compile must not expose the obsolete nested-record input",
);
assert(
  !/require\(["']schema-dsl\/package\.json["']\)/.test(compatWorkflow),
  "compat workflow must not import the unexported schema-dsl/package.json subpath",
);
assert(
  compatWorkflow.includes(
    "require('./node_modules/schema-dsl/package.json').version",
  ),
  "compat workflow must verify the installed schema-dsl version from its filesystem package metadata",
);

for (const name of Object.keys(expected)) {
  const installed = readJson(
    path.join("node_modules", name, "package.json"),
  ).version;
  assert(
    installed === expected[name],
    `${name} installed ${installed}, expected ${expected[name]}`,
  );
}

const tree = JSON.parse(
  execFileSync("npm", ["ls", "schema-dsl", "monsqlize", "--all", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  }),
);

function visit(node, trail = []) {
  for (const [name, dependency] of Object.entries(node?.dependencies ?? {})) {
    const nextTrail = [...trail, `${name}@${dependency.version ?? "unknown"}`];
    if (name === "schema-dsl") {
      assert(
        typeof dependency.version === "string" &&
          dependency.version.startsWith("3."),
        `schema-dsl 2.x or unresolved version found at ${nextTrail.join(" > ")}`,
      );
    }
    visit(dependency, nextTrail);
  }
}
visit(tree);

assert(
  Object.getOwnPropertyDescriptor(String.prototype, "description") ===
    undefined,
  "String.prototype.description exists before importing vextjs",
);

await import(pathToFileURL(path.join(root, "dist/index.js")).href);

assert(
  Object.getOwnPropertyDescriptor(String.prototype, "description") ===
    undefined,
  "importing vextjs must not install String.prototype.description",
);

if (failures.length > 0) {
  console.error("schema-dsl v3 adaptation check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `schema-dsl v3 adaptation verified: vextjs@${pkg.version}, schema-dsl@${expected["schema-dsl"]}, monsqlize@${expected.monsqlize}`,
);
