import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_ORDER_PATH,
  ENTERPRISE_SUITE_ID,
  ENTERPRISE_TARGETS,
  ENTERPRISE_WORKLOADS,
  createFailureRequest,
  createWorkloadRequest,
  resolveBenchmarkIdentity,
} from "../benchmark/enterprise/contract.mjs";

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function markerSection(content: string): string {
  const start = content.indexOf("<!-- enterprise-results:start -->");
  const end = content.indexOf("<!-- enterprise-results:end -->");
  return content.slice(start, end + "<!-- enterprise-results:end -->".length);
}

describe("Enterprise Workload Suite contract", () => {
  it("defines one fixed API contract and the intentionally limited Phase 1 target set", () => {
    expect(ENTERPRISE_SUITE_ID).toBe("vext-enterprise-workload-suite");
    expect(ENTERPRISE_ORDER_PATH).toBe("/api/users/10001/orders");
    expect(ENTERPRISE_TARGETS.map((target) => target.id)).toEqual([
      "vext-native",
      "fastify-native",
      "nest-fastify",
    ]);
    expect(
      ENTERPRISE_WORKLOADS.map((workload) => [
        workload.id,
        workload.expectedStatus,
      ]),
    ).toEqual([
      ["success-cpu", 201],
      ["success-latency-1ms", 201],
      ["success-latency-5ms", 201],
      ["validation-failure", 422],
    ]);

    expect(
      createWorkloadRequest(ENTERPRISE_WORKLOADS[0], "contract-id"),
    ).toMatchObject({
      method: "POST",
      path: ENTERPRISE_ORDER_PATH,
      headers: {
        authorization: "Bearer bench-valid-token",
        "x-request-id": "contract-id",
      },
    });
    expect(
      createFailureRequest("missing-auth").headers.authorization,
    ).toBeUndefined();
    expect(createFailureRequest("forbidden").headers.authorization).toBe(
      "Bearer bench-forbidden-token",
    );

    let authorizationChecks = 0;
    const identity = resolveBenchmarkIdentity("Bearer bench-valid-token", {
      onAuthorization: () => {
        authorizationChecks += 1;
      },
    });
    expect(identity?.can("orders:create")).toBe(true);
    expect(identity?.can("orders:read")).toBe(false);
    expect(authorizationChecks).toBe(2);
    expect(
      resolveBenchmarkIdentity("Bearer bench-forbidden-token")?.can(
        "orders:create",
      ),
    ).toBe(false);
  });

  it("keeps production-shaped semantics out of the existing Adapter Matrix runner", () => {
    const matrixRunner = read("test/benchmark/run-adapter-matrix.mjs");
    const enterpriseRunner = read(
      "test/benchmark/enterprise/run-enterprise-suite.mjs",
    );
    const mapping = read("test/benchmark/enterprise/architecture-mapping.mjs");

    expect(matrixRunner).not.toContain(ENTERPRISE_SUITE_ID);
    expect(enterpriseRunner).toContain("suite: ENTERPRISE_SUITE_ID");
    expect(enterpriseRunner).toContain("runConformance(");
    expect(enterpriseRunner).toContain("round-interleaved-rotating");
    expect(enterpriseRunner).toContain("--pipelining 1");
    expect(enterpriseRunner).toContain('process.platform !== "linux"');
    expect(enterpriseRunner).toContain("taskset");
    expect(enterpriseRunner).toContain("assertFastifyHostParity");
    expect(enterpriseRunner).toContain("assertTargetCpuAffinity");
    expect(enterpriseRunner).toContain("nodeMajor");
    expect(enterpriseRunner).toContain(
      "acceptedForPublication: options.formal",
    );
    expect(mapping).toContain("phaseTwoExcluded");
    expect(mapping).toContain("hono");
    expect(mapping).toContain("less fair");
  });

  it("uses each target's real request pipeline rather than a shared no-op harness", () => {
    const vextConfig = read(
      "test/benchmark/enterprise/fixtures/vext-app/src/config/default.mjs",
    );
    const vextRoute = read(
      "test/benchmark/enterprise/fixtures/vext-app/src/routes/api/users.mjs",
    );
    const fastify = read(
      "test/benchmark/enterprise/targets/fastify-native.mjs",
    );
    const nest = read("test/benchmark/enterprise/targets/nest-fastify.mjs");

    expect(vextConfig).toContain('adapter: "native"');
    expect(vextConfig).toContain("requestContext");
    expect(vextConfig).toContain("accessLog");
    expect(vextConfig).toContain("securityHeaders");
    expect(vextRoute).toContain("auth:");
    expect(vextRoute).toContain("validate:");
    expect(vextRoute).toContain("pattern(/^[A-Z]{3}$/u)");
    expect(fastify).toContain("fastifyOrderSchema()");
    expect(fastify).toContain('app.addHook("preValidation"');
    expect(fastify).toContain("cpuSet: readEffectiveCpuSet()");
    expect(nest).toContain("class EnterpriseGuard");
    expect(nest).toContain("class EnterpriseBodyPipe");
    expect(nest).toContain("class EnterpriseLoggingInterceptor");
    expect(nest).toContain("class EnterpriseExceptionFilter");
    expect(nest).toContain("new FastifyAdapter(raw)");
    expect(nest).toContain("cpuSet: readEffectiveCpuSet()");
  });

  it("keeps the user-facing result, full sample, method, and raw-performance rationale on the same localized page", () => {
    const en = read("website/docs/en/enterprise-benchmark.md");
    const zh = read("website/docs/zh/enterprise-benchmark.md");
    const generator = read(
      "test/benchmark/enterprise/generate-enterprise-results.mjs",
    );
    const readme = read("README.md");

    expect(en).toContain("## Why this is not a raw benchmark");
    expect(zh).toContain("## 为什么不做裸跑排名");
    expect(en).toContain("Target runtime versions");
    expect(zh).toContain("目标运行时版本");
    expect(en).toContain("No accepted formal artifact has been published yet.");
    expect(zh).toContain("尚未发布可接受的正式 artifact。");
    expect(markerSection(en)).not.toContain("github.com/");
    expect(markerSection(zh)).not.toContain("github.com/");
    expect(generator).toContain("Every per-round request count");
    expect(generator).toContain(
      "not moved to GitHub or a separate results page",
    );
    expect(generator).not.toContain("enterprise-benchmark/results");
    expect(generator).toContain("sample.round + 1");
    expect(generator).toContain("Completed / processed requests");
    expect(readme).toContain("Enterprise workload benchmark");
  });

  it("keeps displayed target versions synchronized with the pinned implementation", () => {
    const manifest = JSON.parse(read("package.json"));
    const en = read("website/docs/en/enterprise-benchmark.md");
    const zh = read("website/docs/zh/enterprise-benchmark.md");
    const expectedVersions = [
      manifest.version,
      manifest.devDependencies.fastify,
      manifest.devDependencies["@nestjs/core"],
      manifest.devDependencies["reflect-metadata"],
      manifest.devDependencies.rxjs,
      manifest.devDependencies.autocannon,
    ];

    for (const version of expectedVersions) {
      expect(en).toContain(version);
      expect(zh).toContain(version);
    }
  });

  it("rejects a formal run before any benchmark when the pilot protocol is not frozen", () => {
    const runner = path.join(
      process.cwd(),
      "test/benchmark/enterprise/run-enterprise-suite.mjs",
    );
    const result = spawnSync(process.execPath, [runner, "--formal"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "requires a pilot-frozen protocol",
    );
  });
});
