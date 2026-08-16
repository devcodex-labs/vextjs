import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { observer } from "../fixtures/vext-conformance/src/plugins/benchmark-observer.mjs";
import {
  installConformanceIpc,
  installTargetShutdown,
  sendFailure,
  sendReady,
  waitForStart,
} from "../target-runtime.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..", "fixtures", "vext-conformance");
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  observer.observeLogLine(chunk);
  return originalWrite(chunk, ...args);
};

async function start() {
  await waitForStart();
  const { bootstrap } = await import("../../../../../dist/lib/bootstrap.js");
  const result = await bootstrap(rootDir);
  const shutdown = installTargetShutdown(() => result.serverHandle.close());
  installConformanceIpc({ observer, shutdown });
  sendReady({
    target: "vext-native",
    port: result.serverHandle.port,
    versions: { vext: "formal-bootstrap-native" },
  });
}

start().catch((error) => {
  sendFailure(error);
  console.error(error);
  process.exit(1);
});
