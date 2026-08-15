import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEffectiveCpuSet } from "../target-runtime.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dirname, "..", "..", "..", "..");
const rootDir = join(__dirname, "..", "fixtures", "vext-app");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const bootstrapPath = join(repositoryRoot, "dist", "lib", "bootstrap.js");

if (!existsSync(bootstrapPath)) {
  throw new Error(
    "Vext dist/lib/bootstrap.js is missing; run npm run build first.",
  );
}

let serverHandle;

async function start() {
  const { bootstrap } = await import("../../../../dist/lib/bootstrap.js");
  serverHandle = await bootstrap(rootDir);
  process.send?.({
    type: "ready",
    port: serverHandle.serverHandle.port ?? port,
    target: "vext-native",
    runtime: { adapter: "native", cpuSet: readEffectiveCpuSet() },
  });
}

async function shutdown() {
  if (serverHandle?.serverHandle) {
    await serverHandle.serverHandle.close();
  }
  process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
process.once("disconnect", shutdown);

start().catch((error) => {
  process.send?.({ type: "error", message: error.message });
  console.error(error);
  process.exit(1);
});
