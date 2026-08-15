import { join, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { benchmarkRuntime } from "../fixtures/vext-app/src/plugins/benchmark-runtime.mjs";
import { readEffectiveCpuSet } from "../runtime.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..", "fixtures", "vext-app");
let serverHandle;

async function start() {
  const { bootstrap } = await import("../../../../dist/lib/bootstrap.js");
  const result = await bootstrap(rootDir);
  serverHandle = result.serverHandle;
  process.send?.({
    type: "ready",
    target: "vext-native",
    port: serverHandle.port,
    runtime: { vext: "formal-bootstrap", cpuSet: readEffectiveCpuSet() },
  });
}

async function shutdown() {
  try {
    await serverHandle?.close();
  } finally {
    benchmarkRuntime.close();
    process.exit(0);
  }
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
process.once("disconnect", shutdown);
start().catch((error) => {
  process.send?.({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exit(1);
});
