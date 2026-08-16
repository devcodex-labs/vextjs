/**
 * Independent, non-citable validation for a complete Windows pilot run.
 *
 * Formal acceptance remains the responsibility of validate-artifact.mjs in
 * formal mode. This companion prevents a pilot from being called successful
 * merely because its raw runner reached the final sample.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { jsonSafe, sha256File } from "./artifact-utils.mjs";
import { validatePilotRawArtifact } from "./validate-artifact.mjs";

const __filename = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(__filename), "../../../..");

function parseArgs() {
  const options = {
    input: undefined,
    output: undefined,
    liveConformance: true,
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--input":
        options.input = resolve(repositoryRoot, args[index + 1] ?? "");
        index += 1;
        break;
      case "--output":
        options.output = resolve(repositoryRoot, args[index + 1] ?? "");
        index += 1;
        break;
      case "--no-live-conformance":
        options.liveConformance = false;
        break;
      case "--help":
        console.log(`
Validate a complete non-citable Enterprise Benchmark pilot:
  npm run validate:bench:enterprise:pilot -- --input <pilot-raw.json> --output <pilot-validation.json>
`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${args[index]}`);
    }
  }
  if (!options.input || !options.output) {
    throw new Error("--input and --output are required");
  }
  return options;
}

async function writeAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(jsonSafe(value), null, 2)}\n`);
  await rename(temporary, path);
}

async function main() {
  const options = parseArgs();
  const rawText = await readFile(options.input, "utf8");
  const raw = JSON.parse(rawText);
  const validation = await validatePilotRawArtifact(raw, {
    rawSha256: await sha256File(options.input),
    rawFile: options.input,
    liveConformance: options.liveConformance,
  });
  await writeAtomically(options.output, validation);
  console.log(
    JSON.stringify(
      {
        suite: validation.suite,
        mode: raw.mode,
        controlValid: validation.controlValid,
        citable: validation.citable,
        output: options.output,
        failedGates: validation.gates
          .filter((entry) => entry.status !== "PASS")
          .map((entry) => entry.id),
      },
      null,
      2,
    ),
  );
  if (!validation.controlValid) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
