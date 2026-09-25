import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
for (const args of [
  [
    "--test",
    "test/specification-rules.test.mjs",
    "test/documentation-contract.test.mjs",
  ],
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "test/integration/documentation-routing-pilot.test.ts",
    "test/integration/documentation-guides.test.ts",
  ],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
