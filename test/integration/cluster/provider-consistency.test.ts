import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import {
  PROJECT_ROOT,
  spawnProcess,
  type ManagedProcess,
} from "./helpers.js";

const BOOTSTRAP_ENTRY = join(PROJECT_ROOT, "dist", "lib", "bootstrap.js");
const TEST_TIMEOUT = 30_000;

const activeProcesses: ManagedProcess[] = [];
const tempDirs: string[] = [];

function trackProcess(proc: ManagedProcess): ManagedProcess {
  activeProcesses.push(proc);
  return proc;
}

function trackTempDir(dir: string): string {
  tempDirs.push(dir);
  return dir;
}

async function allocatePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate an ephemeral test port.");
  }

  return address.port;
}

function extractToken(line: string, marker: string): string | null {
  const index = line.indexOf(marker);
  if (index === -1) {
    return null;
  }
  return line.slice(index + marker.length).trim();
}

async function createClusterFixture(port: number): Promise<string> {
  const rootDir = trackTempDir(
    await mkdtemp(join(tmpdir(), "vext-cluster-provider-")),
  );

  await mkdir(join(rootDir, "src", "config"), { recursive: true });
  await mkdir(join(rootDir, "src", "plugins"), { recursive: true });
  await mkdir(join(rootDir, "src", "routes"), { recursive: true });
  await mkdir(join(rootDir, "src", "services"), { recursive: true });
  await mkdir(join(rootDir, "node_modules"), { recursive: true });

  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify(
      {
        name: "cluster-provider-consistency-fixture",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
    "utf-8",
  );

  await writeFile(
    join(rootDir, "src", "config", "default.js"),
    `export default {
  port: ${port},
  host: "127.0.0.1",
  adapter: "native",
  logger: {
    level: "silent",
  },
  accessLog: {
    enabled: false,
  },
  openapi: {
    enabled: false,
  },
  cluster: {
    enabled: true,
    workers: 1,
    autoRestart: false,
    healthCheck: {
      enabled: false,
    },
  },
};
`,
    "utf-8",
  );

  await writeFile(
    join(rootDir, "src", "config", "bootstrap.js"),
    `import cluster from "node:cluster";
import { defineBootstrapConfig } from "vextjs";

const generatedToken = Math.random().toString(36).slice(2);

export default defineBootstrapConfig({
  providers: [
    {
      name: "cluster-consistency-provider",
      load() {
        const role = cluster.isWorker ? "worker" : "master";
        console.log("[test-provider-load] role=" + role + " token=" + generatedToken);
        return {
          providerToken: generatedToken,
        };
      },
    },
  ],
});
`,
    "utf-8",
  );

  await writeFile(
    join(rootDir, "src", "plugins", "provider-token-log.js"),
    `export default {
  name: "provider-token-log",
  setup(app) {
    app.onReady(() => {
      console.log("[test-provider-worker-ready] token=" + app.config.providerToken);
    });
  },
};
`,
    "utf-8",
  );

  await writeFile(
    join(rootDir, "src", "routes", "index.js"),
    `const routes = [];

function makeMethod(method) {
  return (path, optionsOrHandler, handler) => {
    if (typeof optionsOrHandler === "function") {
      routes.push({ method, path, options: {}, handler: optionsOrHandler });
      return;
    }
    routes.push({ method, path, options: optionsOrHandler || {}, handler });
  };
}

const collector = {
  get: makeMethod("GET"),
  post: makeMethod("POST"),
  put: makeMethod("PUT"),
  patch: makeMethod("PATCH"),
  delete: makeMethod("DELETE"),
  head: makeMethod("HEAD"),
  options: makeMethod("OPTIONS"),
};

function factory() {
  collector.get("/health", async (_req, res) => {
    res.json({ ok: true });
  });
}

function normalizePath(prefix, subPath) {
  const cleanPrefix = prefix.endsWith("/") && prefix.length > 1
    ? prefix.slice(0, -1)
    : prefix;
  const cleanSubPath = subPath.startsWith("/") ? subPath.slice(1) : subPath;
  if (!cleanSubPath) return cleanPrefix || "/";
  if (cleanPrefix === "/") return "/" + cleanSubPath;
  const fullPath = cleanPrefix + "/" + cleanSubPath;
  return fullPath.length > 1 && fullPath.endsWith("/")
    ? fullPath.slice(0, -1)
    : fullPath;
}

export default {
  routes,
  sourceFile: "",
  register(adapter, prefix) {
    for (const route of routes) {
      adapter.registerRoute(route.method, normalizePath(prefix, route.path), [
        async (req, res) => {
          await route.handler(req, res);
        },
      ]);
    }
  },
  _factory: factory,
  _collector: collector,
};
`,
    "utf-8",
  );

  const linkedPackage = join(rootDir, "node_modules", "vextjs");
  await symlink(
    PROJECT_ROOT,
    linkedPackage,
    process.platform === "win32" ? "junction" : "dir",
  );

  return rootDir;
}

afterEach(async () => {
  for (const proc of activeProcesses) {
    if (!proc.exited) {
      proc.kill();
      try {
        await proc.waitForExit(5000);
      } catch {
        // ignore cleanup timeout
      }
    }
  }
  activeProcesses.length = 0;

  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("cluster bootstrap provider consistency", () => {
  it(
    "should reuse the master-resolved provider patch in worker startup",
    async () => {
      expect(existsSync(BOOTSTRAP_ENTRY)).toBe(true);

      const port = await allocatePort();
      const fixtureRoot = await createClusterFixture(port);
      const proc = trackProcess(
        spawnProcess(BOOTSTRAP_ENTRY, {
          VEXT_MODE: "start",
          VEXT_CLUSTER: "1",
          VEXT_PORT_CONFLICT: "error",
          VEXT_ROOT: fixtureRoot,
        }),
      );

      const masterLine = await proc.waitForOutput("[test-provider-load] role=master", 15_000);
      const workerLine = await proc.waitForOutput("[test-provider-worker-ready] token=", 15_000);

      const masterToken = extractToken(masterLine, "token=");
      const workerToken = extractToken(workerLine, "token=");

      expect(masterToken).toBeTruthy();
      expect(workerToken).toBe(masterToken);

      const workerLoadLines = proc.lines.filter((line) =>
        line.includes("[test-provider-load] role=worker"),
      );
      expect(workerLoadLines).toHaveLength(0);

      proc.sendSignal("SIGTERM");
      const result = await proc.waitForExit(15_000);
      expect(result.exitCode !== null || result.signal !== null).toBe(true);
    },
    TEST_TIMEOUT,
  );
});

