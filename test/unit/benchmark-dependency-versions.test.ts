import { describe, expect, it } from "vitest";
import {
  AUTOCANNON_VERSION,
  BENCHMARK_PACKAGES,
  ENTERPRISE_BENCHMARK_PACKAGES,
  fetchRegistryLatestVersion,
  readLocalBenchmarkVersions,
  validateBenchmarkDependencyState,
  verifyLatestBenchmarkDependencies,
} from "../benchmark/dependency-versions.mjs";

function registryFetch(versions: Record<string, string>) {
  return async (input: string | URL | Request) => {
    const pathname = new URL(String(input)).pathname;
    const packageName = decodeURIComponent(
      pathname.replace(/^\//, "").replace(/\/latest$/, ""),
    );
    const version = versions[packageName];
    return new Response(JSON.stringify({ version }), {
      status: version ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("benchmark dependency latest-version guard", () => {
  it("keeps every compared framework exact and aligned with package-lock", () => {
    const versions = readLocalBenchmarkVersions(process.cwd());

    expect(Object.keys(versions)).toEqual([...BENCHMARK_PACKAGES]);
    expect(versions.autocannon).toBe(AUTOCANNON_VERSION);
    for (const version of Object.values(versions)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    }
  });

  it("passes only when every local version equals registry latest", async () => {
    const versions = readLocalBenchmarkVersions(process.cwd());
    const result = await verifyLatestBenchmarkDependencies({
      repositoryRoot: process.cwd(),
      fetchImpl: registryFetch(versions),
      registryUrl: "https://registry.test",
    });

    expect(result.rows).toHaveLength(Object.keys(versions).length);
    expect(result.rows.every((row) => row.current)).toBe(true);
  });

  it("keeps the Enterprise Workload Suite dependency gate scoped to its actual targets", async () => {
    const versions = readLocalBenchmarkVersions(process.cwd(), {
      packageNames: ENTERPRISE_BENCHMARK_PACKAGES,
    });

    expect(Object.keys(versions)).toEqual([...ENTERPRISE_BENCHMARK_PACKAGES]);
    expect(versions).toMatchObject({
      fastify: "5.12.0",
      "@nestjs/common": "11.2.1",
      "@nestjs/core": "11.2.1",
      "@nestjs/platform-fastify": "11.2.1",
    });
    const result = await verifyLatestBenchmarkDependencies({
      repositoryRoot: process.cwd(),
      packageNames: ENTERPRISE_BENCHMARK_PACKAGES,
      fetchImpl: registryFetch(versions),
      registryUrl: "https://registry.test",
    });
    expect(result.rows.map((row) => row.packageName)).toEqual([
      ...ENTERPRISE_BENCHMARK_PACKAGES,
    ]);
  });

  it("fails with the exact stale package and versions", async () => {
    const versions = readLocalBenchmarkVersions(process.cwd());
    const registryVersions = { ...versions, fastify: "99.0.0" };

    await expect(
      verifyLatestBenchmarkDependencies({
        repositoryRoot: process.cwd(),
        fetchImpl: registryFetch(registryVersions),
        registryUrl: "https://registry.test",
      }),
    ).rejects.toThrow(
      `fastify: local ${versions.fastify}, registry latest 99.0.0`,
    );
  });

  it("retries transient registry failures without weakening latest checks", async () => {
    let calls = 0;
    const version = await fetchRegistryLatestVersion("fastify", {
      attempts: 3,
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("temporary network failure");
        return new Response(JSON.stringify({ version: "5.12.0" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(version).toBe("5.12.0");
    expect(calls).toBe(2);
  });

  it("does not retry permanent registry client errors", async () => {
    let calls = 0;

    await expect(
      fetchRegistryLatestVersion("missing-package", {
        attempts: 3,
        retryDelayMs: 0,
        fetchImpl: async () => {
          calls += 1;
          return new Response("not found", { status: 404 });
        },
      }),
    ).rejects.toThrow("npm registry returned HTTP 404 for missing-package");
    expect(calls).toBe(1);
  });

  it("rejects a stale installed package even when manifest and lock agree", () => {
    const versions = readLocalBenchmarkVersions(process.cwd());
    const manifest = { devDependencies: { ...versions } };
    const packages: Record<
      string,
      { version?: string; devDependencies?: Record<string, string> }
    > = {
      "": { devDependencies: { ...manifest.devDependencies } },
    };
    for (const packageName of BENCHMARK_PACKAGES) {
      packages[`node_modules/${packageName}`] = {
        version: manifest.devDependencies[packageName],
      };
    }

    expect(() =>
      validateBenchmarkDependencyState({
        manifest,
        lock: { packages },
        installedVersions: { ...manifest.devDependencies, fastify: "5.11.3" },
      }),
    ).toThrow(
      `fastify installed version (5.11.3) does not match ${versions.fastify}`,
    );
  });
});
