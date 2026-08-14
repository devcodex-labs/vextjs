import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function runBenchmarkCli(relativePath: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), relativePath), ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("benchmark report semantics", () => {
  it("renders the Core route-middleware scenario as N/A, not missing data", () => {
    const runner = read("test/benchmark/run-native-fairness.mjs");
    const en = read("website/docs/en/benchmark.md");
    const zh = read("website/docs/zh/benchmark.md");

    expect(runner).toContain(': "N/A";');
    expect(runner).toContain("这表示不适用，不是漏测或零成本");
    expect(
      en.match(/Route middleware chain\s+\|[^\n]*\|\s+N\/A\s+\|/g),
    ).toHaveLength(2);
    expect(
      zh.match(/真实 route middleware 链\s+\|[^\n]*\|\s+N\/A\s+\|/g),
    ).toHaveLength(2);
    expect(en).toContain("neither missing data nor a zero-cost measurement");
    expect(zh).toContain("既不是漏测，也不表示成本为零");
  });

  it("describes the actual Normal global middleware telemetry", () => {
    const config = read(
      "test/benchmark/servers/vext-app/src/config/default.mjs",
    );

    expect(config).toContain("唯一保留的全局生命周期节点是 requestHook");
    expect(config).not.toContain("authContext 和 requestHook");
  });

  it("keeps both localized benchmark pages on the current formal dataset", () => {
    const en = read("website/docs/en/benchmark.md");
    const zh = read("website/docs/zh/benchmark.md");

    for (const page of [en, zh]) {
      expect(page).toContain("26,444");
      expect(page).toContain("33,351");
      expect(page).toContain("-31.6%");
      expect(page).toContain("--process-priority -14");
      expect(page).toContain("programmatic API");
      expect(page).not.toContain(
        "main@cea18d760592b790d602f61f343e8d71c4a35735",
      );
      expect(page).not.toContain("35,283");
      expect(page).not.toContain("-16.3%");
    }
  });

  it("interleaves targets by round and rejects unstable formal samples", () => {
    const runner = read("test/benchmark/run-native-fairness.mjs");
    const matrixRunner = read("test/benchmark/run-benchmark.mjs");

    expect(runner).toContain('targetScheduling: "round-interleaved-rotating"');
    expect(runner).toContain("rotateTargets(");
    expect(runner).toContain("Benchmark CV gate failed");
    expect(runner).toContain("complete: unstable.length === 0");
    expect(runner).toContain(
      "--from-results-json requires at least one JSON artifact",
    );
    expect(runner).toContain("Incomplete Native fairness matrix");
    expect(runner).toContain(
      "Benchmark artifact dependency versions do not match the current lockfile",
    );
    expect(runner).toContain(
      "Benchmark artifact source provenance does not match the current worktree",
    );
    expect(runner).toContain("processPriority: getProcessPriority()");
    expect(matrixRunner).toContain(
      'targetScheduling: "round-interleaved-alternating"',
    );
    expect(matrixRunner).toContain("const rawFirst =");
    expect(matrixRunner).toContain("Benchmark CV gate failed");
    expect(matrixRunner).toContain("no citable report was generated");
    expect(matrixRunner).toContain("processPriority: getProcessPriority()");
    expect(matrixRunner).toContain("applyChildProcessPriority(");
    expect(matrixRunner).toContain(
      "Benchmark artifact source provenance does not match the current worktree",
    );
  });

  it("keeps generated benchmark artifacts out of candidate provenance", () => {
    const runner = read("test/benchmark/run-native-fairness.mjs");
    const matrixRunner = read("test/benchmark/run-benchmark.mjs");
    const benchmarkReadme = read("test/benchmark/README.md");
    const gitignore = read(".gitignore");

    expect(runner).toContain("generatedArtifactPathspecs");
    expect(runner).toContain(
      "candidateSourceState([options.output, options.resultsJson])",
    );
    expect(matrixRunner).toContain("generatedArtifactPathspecs");
    expect(matrixRunner).toContain(
      "getSourceProvenance([opts.output, opts.resultsJson])",
    );
    expect(matrixRunner).toContain("Unknown benchmark framework");
    expect(matrixRunner).toContain("Unable to read benchmark git provenance");
    expect(matrixRunner).not.toContain("⚠️ 报告保存失败");
    expect(runner).toContain("Unable to read benchmark git status");
    expect(gitignore).toContain("/test/benchmark/.artifacts/");
    expect(benchmarkReadme).toContain("test/benchmark/.artifacts/");
    expect(benchmarkReadme).not.toContain("./artifacts/");
  });

  it.each([
    [
      "test/benchmark/run-native-fairness.mjs",
      ["--rounds", "0"],
      "Invalid --rounds",
    ],
    [
      "test/benchmark/run-native-fairness.mjs",
      ["--duration", "1junk"],
      "Invalid --duration",
    ],
    ["test/benchmark/run-benchmark.mjs", ["--rounds", "0"], "Invalid --rounds"],
    [
      "test/benchmark/run-benchmark.mjs",
      ["--connections", "50x"],
      "Invalid --connections",
    ],
  ])(
    "rejects malformed numeric CLI input before benchmarking (%s %j)",
    (runner, args, expected) => {
      const result = runBenchmarkCli(runner, args);

      expect(result.status).toBe(1);
      expect(result.output).toContain(expected);
    },
  );
});
