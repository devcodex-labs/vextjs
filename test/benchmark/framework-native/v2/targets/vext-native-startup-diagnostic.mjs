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

function progress(stage) {
  process.send?.({ type: "progress", stage, pid: process.pid });
}

async function start() {
  await waitForStart();
  progress("before-bootstrap-import");
  const { bootstrap } = await import("../../../../../dist/lib/bootstrap.js");
  progress("before-bootstrap");
  const result = await bootstrap(rootDir);
  progress("after-bootstrap");
  installTargetShutdown(() => result.serverHandle.close());
  sendReady({
    target: "vext-native-startup-diagnostic",
    port: result.serverHandle.port,
  });
}

start().catch((error) => {
  sendFailure(error);
  console.error(error);
  process.exit(1);
});
