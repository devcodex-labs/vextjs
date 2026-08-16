import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  installTargetShutdown,
  sendFailure,
  sendReady,
  waitForStart,
} from "../target-runtime.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..", "fixtures", "vext-measurement");

async function start() {
  await waitForStart();
  const { bootstrap } = await import("../../../../../dist/lib/bootstrap.js");
  const result = await bootstrap(rootDir);
  installTargetShutdown(() => result.serverHandle.close());
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
