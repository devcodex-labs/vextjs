import fs from "node:fs";
import path from "node:path";
import { importUserModule } from "../../src/lib/user-module-loader.js";

async function main() {
  const [root, filename] = process.argv.slice(2);
  const [first, second] = await Promise.all([
    importUserModule(filename!, root!),
    importUserModule(filename!, root!),
  ]);
  const state = globalThis as typeof globalThis & {
    __vextOwnedModuleCount?: number;
  };
  process.stdout.write(
    JSON.stringify({
      pid: process.pid,
      same: first === second,
      count: state.__vextOwnedModuleCount,
      location: first.location,
      value: await (first.later as () => Promise<string>)(),
      temporary: fs
        .readdirSync(path.dirname(filename!))
        .filter((name) => name.startsWith(".vext-exec-")),
      receipts: fs.readdirSync(
        path.join(root!, ".vext/freshness/v1/temporary"),
      ),
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
