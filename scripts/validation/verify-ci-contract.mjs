#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const workflow = readFileSync(
  path.join(root, ".github", "workflows", "ci.yml"),
  "utf8",
);
const releaseWorkflow = readFileSync(
  path.join(root, ".github", "workflows", "release.yml"),
  "utf8",
);
const bashLocalCi = readFileSync(
  path.join(root, "scripts", "ci-local.sh"),
  "utf8",
);
const powershellLocalCi = readFileSync(
  path.join(root, "scripts", "ci-local.ps1"),
  "utf8",
);
const sourcePreflight = readFileSync(
  path.join(root, "scripts", "release-preflight.mjs"),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);

function fail(message) {
  console.error(`CI contract verification failed: ${message}`);
  process.exit(1);
}

function extractJobBlock(source, jobName) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) fail(`missing job ${jobName}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [a-z0-9][a-z0-9-]*:\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function jobBlock(jobName) {
  return extractJobBlock(workflow, jobName);
}

function releaseJobBlock(jobName) {
  return extractJobBlock(releaseWorkflow, jobName);
}

function requireTokens(label, content, tokens) {
  for (const token of tokens) {
    if (!content.includes(token)) fail(`${label} is missing ${token}`);
  }
}

function requireOrderedTokens(label, content, tokens) {
  let previous = -1;
  for (const token of tokens) {
    const current = content.indexOf(token, previous + 1);
    if (current === -1) fail(`${label} is missing ${token}`);
    if (current <= previous) fail(`${label} has ${token} out of order`);
    previous = current;
  }
}

if (
  packageJson.scripts?.["test:types"] !==
  "tsc -p test/types/tsconfig.json --pretty false"
) {
  fail("package.json must expose the isolated test:types contract");
}

requireTokens("lint-typecheck", jobBlock("lint-typecheck"), [
  "fetch-depth: 0",
  "npm run lint",
  "npm run format:check",
  "FORMAT_CHECK_BASE:",
  "github.event.pull_request.base.sha || github.event.before",
  "npm run typecheck",
  "npm run test:types",
  "npm run build",
]);
requireOrderedTokens("lint-typecheck", jobBlock("lint-typecheck"), [
  "npm run typecheck",
  "npm run test:types",
  "npm run build",
]);

requireOrderedTokens("Bash local CI", bashLocalCi, [
  "npm run typecheck",
  "npm run test:types",
  "npm run build",
  "npm run format:check",
]);
requireOrderedTokens("PowerShell local CI", powershellLocalCi, [
  "npm run typecheck",
  "npm run test:types",
  "npm run build",
  "npm run format:check",
]);
requireOrderedTokens("source preflight", sourcePreflight, [
  '"typecheck", npm, ["run", "typecheck"]',
  '"public type contract tests", npm, ["run", "test:types"]',
  '"ESM/CJS build", npm, ["run", "build"]',
]);

requireTokens("docs-build", jobBlock("docs-build"), [
  "package-lock.json",
  "website/package-lock.json",
  "Install package dependencies",
  "Build package for executable CLI contract",
  "verify-documentation-contract.mjs",
  "npm run build",
  "verify-documentation-contract.mjs --rendered",
]);
requireOrderedTokens("docs-build", jobBlock("docs-build"), [
  "Install package dependencies",
  "Build package for executable CLI contract",
  "Verify documentation source contract",
  "Build docs (rspress build)",
  "Verify rendered documentation contract",
]);

requireTokens("package-contracts", jobBlock("package-contracts"), [
  "npm run verify:exports",
  "npm run verify:package-composition",
  "npm run verify:adapters",
]);

requireTokens("coverage", jobBlock("coverage"), [
  "node-version: 22",
  "npm run test:cov",
  "coverage/lcov.info",
]);

requireTokens("windows-node22", jobBlock("windows-node22"), [
  "runs-on: windows-latest",
  "node-version: 22",
  "test/unit/path-boundary.test.ts",
  "test/unit/cli/build-command.test.ts",
  "test/unit/frontend-deploy-validation.test.ts",
  "npm run verify:exports",
]);

requireTokens("CI aggregate", jobBlock("ci-ok"), [
  "name: CI ✅",
  "package-contracts,",
  "windows-node22,",
  "needs.package-contracts.result",
  "needs.windows-node22.result",
]);

requireTokens("release freeze-candidate", releaseJobBlock("freeze-candidate"), [
  "needs: [ci, version-check, docs-build]",
  "npm run freeze:release-candidate",
  "repository: devcodex-labs/vextjs-test",
  "consumer-commit: ${{ steps.consumer-checkout.outputs.commit }}",
  "VEXTJS_TEST_TOKEN: ${{ secrets.VEXTJS_TEST_TOKEN || secrets.VEXTJS_GH_PAGES_TOKEN }}",
  "persist-credentials: false",
  "actions/upload-artifact@v7",
  "vextjs-release-candidate-${{ github.run_id }}-${{ github.run_attempt }}",
]);
requireOrderedTokens(
  "release clean candidate freeze",
  releaseJobBlock("freeze-candidate"),
  [
    "npm run freeze:release-candidate",
    "Checkout external consumer main for commit resolution",
  ],
);
requireTokens("release manual trigger", releaseWorkflow, [
  "  workflow_dispatch:",
]);
requireTokens("release entry", releaseJobBlock("version-check"), [
  "run: node scripts/release-entry.mjs",
  "if: github.event_name == 'workflow_dispatch'\n        run: bash scripts/check-version-sync.sh\n",
  "if: github.event_name == 'push'\n        run: bash scripts/check-version-sync.sh --release",
]);
for (const job of ["ci", "docs-build"]) {
  requireTokens(`release ${job} entry gate`, releaseJobBlock(job), [
    "needs: version-check",
  ]);
}
requireTokens("release publication guard", releaseJobBlock("publish"), [
  "if: github.event_name == 'push' && github.ref_type == 'tag'",
]);
requireTokens(
  "release external-consumer",
  releaseJobBlock("external-consumer"),
  [
    "os: [ubuntu-latest, windows-latest]",
    "node-version: [20, 22]",
    "ref: ${{ needs.freeze-candidate.outputs.consumer-commit }}",
    "token: ${{ secrets.VEXTJS_TEST_TOKEN || secrets.VEXTJS_GH_PAGES_TOKEN }}",
    "persist-credentials: false",
    "actions/download-artifact@v8",
    "run-external-consumer-cell.mjs",
    "vextjs-external-cell-${{ matrix.os }}-node${{ matrix.node-version }}",
  ],
);
requireTokens(
  "release aggregate-evidence",
  releaseJobBlock("aggregate-evidence"),
  [
    "needs: [freeze-candidate, external-consumer]",
    "pattern: vextjs-external-cell-*",
    "merge-multiple: true",
    "assemble-external-evidence.mjs",
    "vextjs-qualified-release-${{ github.run_id }}-${{ github.run_attempt }}",
  ],
);
requireOrderedTokens("release publish", releaseJobBlock("publish"), [
  "id-token: write",
  "npm install --global npm@11.19.1",
  "actions/download-artifact@v8",
  "VEXT_PREFLIGHT_VEXT_TARBALL=",
  "VEXT_PREFLIGHT_CANDIDATE_RECEIPT=",
  "VEXT_EXTERNAL_EVIDENCE_FILE=",
  "npm run release:preflight:final",
  'npm publish "${VEXT_PREFLIGHT_VEXT_TARBALL}"',
]);
if (releaseJobBlock("publish").includes("NPM_TOKEN")) {
  throw new Error(
    "release publish must use npm Trusted Publishing instead of NPM_TOKEN",
  );
}

console.log("CI workflow contract verified.");
