import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertPublishable,
  resolveDocsRollout,
  resolveDocsVerification,
} from "./docs-rollout.mjs";

const website = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.resolve(website, "..");
const [command, ...args] = process.argv.slice(2);
if (!["build", "dev", "publish", "verify-rendered"].includes(command))
  throw new Error(`Unknown docs command: ${command}`);
const rollout = resolveDocsRollout(args);
const verification = resolveDocsVerification(args);
if (command === "publish") assertPublishable(rollout, verification);
const env = { ...process.env, VEXT_DOCS_ROLLOUT: rollout };
if (verification.scope === "page")
  env.VEXT_DOCS_PAGE = verification.sourcePath.replace(/^website\/docs\//, "");
const forwarded = args.filter(
  (arg, i) =>
    arg !== "--rollout" &&
    !arg.startsWith("--rollout=") &&
    args[i - 1] !== "--rollout" &&
    arg !== "--page" &&
    !arg.startsWith("--page=") &&
    args[i - 1] !== "--page",
);
const rspress = path.join(website, "node_modules/@rspress/core/bin/rspress.js");
function run(script, scriptArgs = [], cwd = root) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function verifyRendered() {
  run(path.join(root, "scripts/validation/verify-documentation-contract.mjs"), [
    "--rendered",
    `--rollout=${rollout}`,
  ]);
  if (verification.scope === "stage")
    run("--test", ["test/documentation-rendered-contract.test.mjs"]);
}
if (command === "verify-rendered") {
  verifyRendered();
} else if (command === "dev") {
  const child = spawn(process.execPath, [rspress, "dev", ...forwarded], {
    cwd: website,
    env,
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  if (command === "publish") {
    run(
      path.join(root, "scripts/validation/verify-documentation-contract.mjs"),
      ["--rollout=final"],
    );
    run(path.join(root, "scripts/validation/verify-docs-routing-pilot.mjs"));
  }
  run(rspress, ["build", ...forwarded], website);
  run(path.join(website, "scripts/generate-machine-artifacts.mjs"));
  if (command === "publish") verifyRendered();
}
