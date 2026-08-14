import { verifyLatestBenchmarkDependencies } from "./dependency-versions.mjs";

try {
  const result = await verifyLatestBenchmarkDependencies();
  console.log(`Benchmark dependencies match npm latest (${result.checkedAt}):`);
  for (const row of result.rows) {
    console.log(`- ${row.packageName}: ${row.local}`);
  }
} catch (error) {
  console.error(
    `Benchmark dependency verification failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}
