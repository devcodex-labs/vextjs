import path from "node:path";
import { withProjectOwner } from "../../src/lib/project/owner.js";
import { withTemporaryArtifact } from "../../src/lib/project/temporary-artifact.js";

const root = process.argv[2]!;
void withProjectOwner(root, "build", [path.join(root, "generated")], () =>
  withTemporaryArtifact(
    {
      rootDir: root,
      logicalPath: path.join(root, "generated/extract.mjs"),
      contents: 'export default "interrupted";',
    },
    async (file) => {
      console.log(JSON.stringify({ pid: process.pid, file }));
      process.kill(process.pid, "SIGKILL");
    },
  ),
).catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
