import fs from "node:fs";
import path from "node:path";
import { withProjectOwner } from "../../src/lib/project/owner.js";
import {
  withArtifactTransaction,
  withArtifactGroupTransaction,
} from "../../src/lib/project/artifact-transaction.js";
import { ARTIFACT_MANIFEST_FILE } from "../../src/lib/project/artifact-manifest.js";

const root = process.argv[2]!;
const outDir = process.argv[5] ?? path.join(root, "dist");
const phase = process.argv[3] ?? "output";
const grouped = process.argv[4] === "group";
const generatedDir = path.join(root, ".vext/generated/frontend");
const write = fs.writeFileSync;
fs.writeFileSync = (file, data, options) => {
  write(file, data, options);
  if (phase === "preparation" && String(file).endsWith("0-after"))
    process.kill(process.pid, "SIGKILL");
};
const rename = fs.renameSync;
fs.renameSync = (source, target) => {
  rename(source, target);
  const destination =
    phase === "manifest"
      ? path.join(root, ARTIFACT_MANIFEST_FILE)
      : path.join(outDir, "a.js");
  if (
    phase !== "preparation" &&
    path.relative(destination, String(target)) === ""
  )
    process.kill(process.pid, "SIGKILL");
};
void withProjectOwner(
  root,
  "build",
  grouped ? [outDir, generatedDir] : [outDir],
  () =>
    grouped
      ? withArtifactGroupTransaction(
          {
            rootDir: root,
            outputs: [
              { outDir, producer: "backend" },
              { outDir: generatedDir, producer: "frontend-generated" },
            ],
          },
          (value) =>
            value.commit([
              {
                outDir,
                producer: "backend",
                files: [{ path: path.join(outDir, "a.js"), contents: "new a" }],
              },
              {
                outDir: generatedDir,
                producer: "frontend-generated",
                files: [
                  { path: path.join(generatedDir, "b.js"), contents: "new b" },
                ],
              },
            ]),
        )
      : withArtifactTransaction(
          { rootDir: root, outDir, producer: "backend" },
          (value) =>
            value.commit([
              { path: path.join(outDir, "a.js"), contents: "new a" },
              { path: path.join(outDir, "b.js"), contents: "new b" },
            ]),
        ),
).then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(2);
  },
);
