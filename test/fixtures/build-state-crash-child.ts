import fs from "node:fs";
import path from "node:path";
import {
  completeBuild,
  type BuildIdentity,
} from "../../src/lib/build/build-location.js";
import { ARTIFACT_MANIFEST_FILE } from "../../src/lib/project/artifact-manifest.js";

const root = process.argv[2]!;
const phase = process.argv[3]!;
const identity = JSON.parse(
  fs.readFileSync(path.join(root, "build-attempt.json"), "utf8"),
) as BuildIdentity;
const destination = path.join(
  root,
  phase === "output"
    ? "release/.vext-build.json"
    : phase === "pointer"
      ? ".vext/build-location.json"
      : ARTIFACT_MANIFEST_FILE,
);
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  rename(from, to);
  if (path.relative(destination, String(to)) === "") {
    fs.writeFileSync(
      path.join(root, "crash-point.json"),
      JSON.stringify({ phase, pid: process.pid }),
    );
    process.kill(process.pid, "SIGKILL");
  }
};
void completeBuild(root, identity).then(
  () => {
    process.exitCode = 0;
  },
  (error) => {
    console.error(error);
    process.exitCode = 2;
  },
);
