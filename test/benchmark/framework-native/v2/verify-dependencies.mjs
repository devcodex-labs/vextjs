import {
  FRAMEWORK_NATIVE_BENCHMARK_PACKAGES,
  verifyLatestBenchmarkDependencies,
} from "../../dependency-versions.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(__dirname, "../../../..");

try {
  const result = await verifyLatestBenchmarkDependencies({
    repositoryRoot,
    packageNames: FRAMEWORK_NATIVE_BENCHMARK_PACKAGES,
  });
  console.log(
    `Enterprise v2 benchmark dependencies match npm latest (${result.checkedAt}):`,
  );
  for (const row of result.rows) {
    console.log(`- ${row.packageName}: ${row.local}`);
  }
} catch (error) {
  console.error(
    `Enterprise v2 benchmark dependency verification failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}
