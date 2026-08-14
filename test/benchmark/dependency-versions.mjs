import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const AUTOCANNON_VERSION = "8.0.0";
export const NPM_REGISTRY_URL = "https://registry.npmjs.org";
export const BENCHMARK_PACKAGES = Object.freeze([
  "fastify",
  "hono",
  "@hono/node-server",
  "express",
  "koa",
  "@koa/router",
  "autocannon",
]);

function assertExactVersion(packageName, version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    throw new Error(
      `Benchmark dependency ${packageName} must use an exact version; received ${JSON.stringify(version)}`,
    );
  }
}

export function validateBenchmarkDependencyState({
  manifest,
  lock,
  installedVersions,
}) {
  const lockRoot = lock.packages?.[""];
  const versions = {};

  for (const packageName of BENCHMARK_PACKAGES) {
    const declared = manifest.devDependencies?.[packageName];
    const lockDeclared = lockRoot?.devDependencies?.[packageName];
    const lockResolved =
      lock.packages?.[`node_modules/${packageName}`]?.version;
    const installed = installedVersions[packageName];
    assertExactVersion(packageName, declared);
    if (lockDeclared !== declared) {
      throw new Error(
        `Benchmark dependency ${packageName} differs between package.json (${declared}) and package-lock.json (${lockDeclared ?? "missing"})`,
      );
    }
    if (lockResolved !== declared) {
      throw new Error(
        `Benchmark dependency ${packageName} lock resolution (${lockResolved ?? "missing"}) does not match ${declared}`,
      );
    }
    if (installed !== declared) {
      throw new Error(
        `Benchmark dependency ${packageName} installed version (${installed ?? "missing"}) does not match ${declared}; run npm install before benchmarking`,
      );
    }
    versions[packageName] = declared;
  }

  if (versions.autocannon !== AUTOCANNON_VERSION) {
    throw new Error(
      `Autocannon runner version (${AUTOCANNON_VERSION}) does not match installed benchmark dependency ${versions.autocannon}`,
    );
  }
  return versions;
}

export function readLocalBenchmarkVersions(
  repositoryRoot = resolve(__dirname, "../.."),
) {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  );
  const lock = JSON.parse(
    readFileSync(join(repositoryRoot, "package-lock.json"), "utf8"),
  );
  const installedVersions = {};
  for (const packageName of BENCHMARK_PACKAGES) {
    const installedManifest = JSON.parse(
      readFileSync(
        join(repositoryRoot, "node_modules", packageName, "package.json"),
        "utf8",
      ),
    );
    installedVersions[packageName] = installedManifest.version;
  }
  return validateBenchmarkDependencyState({
    manifest,
    lock,
    installedVersions,
  });
}

export async function fetchRegistryLatestVersion(
  packageName,
  {
    fetchImpl = globalThis.fetch,
    registryUrl = NPM_REGISTRY_URL,
    signal,
    attempts = 3,
    retryDelayMs = 250,
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is unavailable; Node.js 20+ is required");
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(
      `Registry attempts must be a positive integer: ${attempts}`,
    );
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new Error(
      `Registry retry delay must be a non-negative number: ${retryDelayMs}`,
    );
  }
  const encodedName = packageName.replace("/", "%2F");
  const url = `${registryUrl.replace(/\/$/, "")}/${encodedName}/latest`;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: signal ?? AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(
          `npm registry request failed for ${packageName} after ${attempts} attempt(s): ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, retryDelayMs * attempt),
      );
      continue;
    }
    const retryableStatus =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;
    if (!response.ok) {
      if (retryableStatus && attempt < attempts) {
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, retryDelayMs * attempt),
        );
        continue;
      }
      throw new Error(
        `npm registry returned HTTP ${response.status} for ${packageName}`,
      );
    }
    const metadata = await response.json();
    assertExactVersion(packageName, metadata.version);
    return metadata.version;
  }
  throw new Error(`npm registry verification exhausted for ${packageName}`);
}

export async function verifyLatestBenchmarkDependencies({
  repositoryRoot,
  fetchImpl,
  registryUrl = NPM_REGISTRY_URL,
} = {}) {
  const local = readLocalBenchmarkVersions(repositoryRoot);
  const rows = await Promise.all(
    BENCHMARK_PACKAGES.map(async (packageName) => {
      const latest = await fetchRegistryLatestVersion(packageName, {
        fetchImpl,
        registryUrl,
      });
      return {
        packageName,
        local: local[packageName],
        latest,
        current: local[packageName] === latest,
      };
    }),
  );
  const stale = rows.filter((row) => !row.current);
  if (stale.length > 0) {
    throw new Error(
      `Benchmark dependencies are not current:\n${stale
        .map(
          (row) =>
            `- ${row.packageName}: local ${row.local}, registry latest ${row.latest}`,
        )
        .join("\n")}`,
    );
  }
  return {
    checkedAt: new Date().toISOString(),
    registryUrl,
    versions: local,
    rows,
  };
}
