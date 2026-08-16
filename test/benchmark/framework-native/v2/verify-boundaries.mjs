import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(__dirname, "../../../..");
const allowed = [
  "package.json",
  "README.md",
  "test/benchmark/framework-native/v2/",
  "website/docs/en/enterprise-benchmark.md",
  "website/docs/zh/enterprise-benchmark.md",
  "website/docs/public/benchmark/enterprise-framework-native-v2-manifest.json",
  // Windows preserves the fixture directory's read-only attribute during cp().
  // This test-only cleanup makes the repository-wide validation gate usable;
  // it does not change framework runtime behavior or the benchmark workload.
  "test/unit/cli/typegen.test.ts",
];
const forbidden = /^(src|types|lib)\//u;

function git(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .split(/\r?\n/u)
    .filter(Boolean);
}

function allowedPath(path) {
  return allowed.some((entry) => path === entry || path.startsWith(entry));
}

try {
  const base = git(["merge-base", "HEAD", "main"])[0];
  const committed = git(["diff", "--name-only", `${base}..HEAD`]);
  const working = git(["status", "--porcelain=v1", "--untracked-files=all"])
    .map((line) => line.slice(3).trim())
    .map((path) => path.replace(/^.* -> /u, ""));
  const paths = [...new Set([...committed, ...working])];
  const blocked = paths.filter(
    (path) => forbidden.test(path) || !allowedPath(path),
  );
  if (blocked.length > 0) {
    throw new Error(
      `Framework-native v2 boundary violation:\n${blocked.map((path) => `- ${path}`).join("\n")}`,
    );
  }
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        base,
        checkedPaths: paths.sort(),
        forbiddenRuntimePaths: paths.filter((path) => forbidden.test(path)),
        testHarnessOnlyPaths: paths.filter(
          (path) => path === "test/unit/cli/typegen.test.ts",
        ),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
