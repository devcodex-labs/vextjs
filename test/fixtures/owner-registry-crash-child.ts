import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ownerRegistryDirectory } from "../../src/lib/project/owner-endpoint.js";
import { withOwnerRegistry } from "../../src/lib/project/owner-registry.js";

const root = process.argv[2]!;
const mode = process.argv[3]!;
const directory = ownerRegistryDirectory();
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(
  path.join(directory, "registry.json"),
  '{"schemaVersion":1,"records":[]}\n',
);
const write = fs.writeFileSync;
const rename = fs.renameSync;
function interrupt(from: string, to: string): void {
  write(
    path.join(root, "crash-point.json"),
    JSON.stringify({ mode, pid: process.pid, from, to }),
  );
  process.kill(process.pid, "SIGKILL");
}
if (mode === "partial") {
  fs.writeFileSync = ((file, data, options) => {
    if (String(file).endsWith(".tmp")) {
      const bytes = Buffer.from(data as string);
      write(file, bytes.subarray(0, Math.floor(bytes.length / 2)), options);
      interrupt(String(file), path.join(directory, "registry.json"));
      return;
    }
    write(file, data, options);
  }) as typeof fs.writeFileSync;
} else {
  fs.renameSync = (from, to) => {
    if (path.basename(String(to)) === "registry.json")
      interrupt(String(from), String(to));
    rename(from, to);
  };
}
void withOwnerRegistry(async (records) => {
  records.push({
    identity: {
      protocolVersion: 1,
      realRoot: root,
      instanceId: randomUUID(),
      pid: process.pid,
      processStartIdentity: `${process.pid}:${performance.timeOrigin}`,
      producerVersion: "test",
      purpose: "build",
    },
    participants: [],
  });
}).catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
