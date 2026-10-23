/**
 * Shared MongoDB target for integration tests.
 *
 * Default: an in-process `mongodb-memory-server-core` instance using the same
 * pinned binary as `plugin-lifecycle.test.ts` and `verify-examples.mjs`, cached
 * under `.cache/mongodb-binaries` (override with `MONGOMS_DOWNLOAD_DIR`). Tests
 * therefore pass without any MongoDB service.
 *
 * Optional override: set `VEXT_TEST_MONGODB_URI` to run against an existing
 * server instead; nothing is started or stopped in that case.
 */
import { join } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server-core";

export const TEST_MONGO_BINARY_VERSION = "8.2.6";
export const TEST_MONGO_STARTUP_TIMEOUT = Number(
  process.env.VEXT_TEST_MONGO_STARTUP_TIMEOUT_MS ?? 300_000,
);

export interface TestMongo {
  /** Server URI without a database path. */
  uri: string;
  /** `memory` when started here, `external` when VEXT_TEST_MONGODB_URI is used. */
  source: "memory" | "external";
  stop(): Promise<void>;
}

const MONGOMS_KEYS = [
  "MONGOMS_VERSION",
  "MONGOMS_DOWNLOAD_DIR",
  "MONGOMS_PREFER_GLOBAL_PATH",
] as const;

export async function startTestMongo(): Promise<TestMongo> {
  const external = process.env.VEXT_TEST_MONGODB_URI?.trim();
  if (external) {
    const uri = new URL(external);
    uri.pathname = "/";
    return { uri: uri.toString(), source: "external", stop: async () => {} };
  }
  const original = Object.fromEntries(
    MONGOMS_KEYS.map((key) => [key, process.env[key]]),
  );
  const downloadDir =
    process.env.MONGOMS_DOWNLOAD_DIR ??
    join(process.cwd(), ".cache", "mongodb-binaries");
  process.env.MONGOMS_VERSION = TEST_MONGO_BINARY_VERSION;
  process.env.MONGOMS_DOWNLOAD_DIR = downloadDir;
  process.env.MONGOMS_PREFER_GLOBAL_PATH = "false";
  const restore = () => {
    for (const key of MONGOMS_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  };
  let server: MongoMemoryServer;
  try {
    server = await MongoMemoryServer.create({
      binary: { version: TEST_MONGO_BINARY_VERSION, downloadDir },
    });
  } catch (error) {
    restore();
    throw error;
  }
  return {
    uri: server.getUri(),
    source: "memory",
    async stop() {
      try {
        await server.stop();
      } finally {
        restore();
      }
    },
  };
}
