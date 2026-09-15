#!/usr/bin/env node
import ts from "typescript";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  fingerprintImplementationTree,
  readImplementationFile,
} from "../src/lib/project/implementation-fingerprint.mjs";
import {
  BUILD_INPUT_FILES,
  inspectBuildInputs,
  publishImplementationManifest,
  completeImplementationBuild,
} from "./implementation-manifest.mjs";

const root = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const args = process.argv.slice(2);
if (
  args.some((arg) => !["--esm", "--cjs", "--watch"].includes(arg)) ||
  args.length > 1
)
  throw new Error("Usage: build-framework.mjs [--esm|--cjs|--watch]");
const watch = args.includes("--watch");
const cjsOnly = args.includes("--cjs");
const lock = path.join(root, ".vext-framework-build.lock");
const descriptor = openSync(lock, "wx");
writeFileSync(
  descriptor,
  JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
);
closeSync(descriptor);
let released = false;
function release() {
  if (released) return;
  released = true;
  try {
    unlinkSync(lock);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
process.once("exit", release);

function copyRuntimeAssets(inputDigest) {
  const folder = path.join(root, "dist/lib/project");
  mkdirSync(folder, { recursive: true });
  for (const name of [
    "implementation-fingerprint.mjs",
    "implementation-fingerprint.d.mts",
  ])
    copyFileSync(
      path.join(root, "src/lib/project", name),
      path.join(folder, name),
    );
  const implementation = path.join(
    root,
    "dist/assistant/implementation-identity.js",
  );
  if (existsSync(implementation)) {
    const source = readImplementationFile(implementation, 1024 * 1024).toString(
      "utf8",
    );
    const stamp = /const COMPILED_INPUT_DIGEST = (?:null|"[a-f0-9]{64}");/g;
    if ([...source.matchAll(stamp)].length !== 1)
      throw new Error("Missing or ambiguous compiled implementation stamp.");
    writeFileSync(
      implementation,
      source.replace(
        stamp,
        "const COMPILED_INPUT_DIGEST = " + JSON.stringify(inputDigest) + ";",
      ),
    );
  }
}

const diagnosticHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => root,
  getNewLine: () => "\n",
};
function diagnostics(items) {
  if (items.length)
    process.stderr.write(
      ts.formatDiagnosticsWithColorAndContext(items, diagnosticHost),
    );
}

if (watch) {
  let before;
  let buildId;
  const host = ts.createWatchCompilerHost(
    path.join(root, "tsconfig.json"),
    {},
    ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    (item) => diagnostics([item]),
    (item) =>
      process.stdout.write(
        ts.flattenDiagnosticMessageText(item.messageText, "\n") + "\n",
      ),
  );
  const createProgram = host.createProgram;
  host.createProgram = (...input) => {
    buildId = randomUUID();
    before = inspectBuildInputs(root);
    publishImplementationManifest(root, { state: "building", buildId });
    return createProgram(...input);
  };
  host.afterProgramCreate = (program) => {
    try {
      const errors = [
        ...program.getConfigFileParsingDiagnostics(),
        ...program.getOptionsDiagnostics(),
        ...program.getGlobalDiagnostics(),
        ...program.getSyntacticDiagnostics(),
        ...program.getSemanticDiagnostics(),
      ];
      diagnostics(errors);
      if (
        errors.some((error) => error.category === ts.DiagnosticCategory.Error)
      )
        return;
      const emitted = program.emit();
      diagnostics(emitted.diagnostics);
      if (
        emitted.emitSkipped ||
        emitted.diagnostics.some(
          (error) => error.category === ts.DiagnosticCategory.Error,
        )
      )
        return;
      copyRuntimeAssets(before.inputDigest);
      completeImplementationBuild(root, before, buildId, ["esm"]);
      process.stdout.write(
        "[vext build] ESM implementation manifest updated.\n",
      );
    } catch (error) {
      process.stderr.write(String(error) + "\n");
    }
  };
  let watcher = ts.createWatchProgram(host);
  let timer;
  let stopping = false;
  const restartWatch = (file) => {
    if (stopping) return;
    publishImplementationManifest(root, {
      state: "building",
      buildId: randomUUID(),
    });
    if (
      file.startsWith("scripts/") ||
      file.endsWith("implementation-fingerprint.mjs")
    ) {
      process.stderr.write(
        "[vext build] Build tooling changed; restart npm run dev before using these outputs.\n",
      );
      stop(1);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      watcher.close();
      watcher = ts.createWatchProgram(host);
    }, 100);
  };
  // Runtime assets and build inputs are outside the TS source graph.
  const extraWatchers = [
    ...BUILD_INPUT_FILES,
    "src/lib/project/implementation-fingerprint.mjs",
  ].map((file) =>
    ts.sys.watchFile(path.join(root, file), () => restartWatch(file), 250),
  );
  const stop = (code = 0) => {
    stopping = true;
    clearTimeout(timer);
    extraWatchers.forEach((item) => item.close());
    watcher.close();
    release();
    process.exit(code);
  };
  process.once("SIGINT", () => stop());
  process.once("SIGTERM", () => stop());
} else {
  const buildId = randomUUID();
  const before = inspectBuildInputs(root);
  try {
    if (cjsOnly) {
      const { readFileSync } = await import("node:fs");
      const previous = JSON.parse(
        readFileSync(path.join(root, "dist/.implementation.json"), "utf8"),
      );
      if (
        previous.state !== "complete" ||
        previous.inputDigest !== before.inputDigest ||
        previous.outputDigest !==
          fingerprintImplementationTree(path.join(root, "dist")) ||
        !previous.formats?.includes("esm")
      )
        throw new Error(
          "CJS build requires current ESM outputs. Run npm run build first.",
        );
    }
    publishImplementationManifest(root, { state: "building", buildId });
    if (!args.includes("--esm") && !cjsOnly) {
      const dist = path.join(root, "dist");
      if (path.dirname(dist) !== root || path.basename(dist) !== "dist")
        throw new Error("Invalid framework output path.");
      // Keep the building marker visible while removing only this build's output children.
      const { readdirSync } = await import("node:fs");
      for (const entry of readdirSync(dist)) {
        if (entry === ".implementation.json") continue;
        const target = path.join(dist, entry);
        const resolved = realpathSync(target);
        const relative = path.relative(dist, resolved);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
          throw new Error("Framework cleanup target escapes dist.");
        rmSync(target, { recursive: true, force: true });
      }
    }
    if (!cjsOnly) {
      const loaded = ts.readConfigFile(
        path.join(root, "tsconfig.json"),
        ts.sys.readFile,
      );
      if (loaded.error) {
        diagnostics([loaded.error]);
        throw new Error("Invalid framework tsconfig.");
      }
      const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
      const program = ts.createProgram(config.fileNames, config.options);
      const errors = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
      diagnostics(errors);
      if (
        errors.some((error) => error.category === ts.DiagnosticCategory.Error)
      )
        throw new Error("Framework type checking failed.");
      const emitted = program.emit();
      diagnostics(emitted.diagnostics);
      if (
        emitted.emitSkipped ||
        emitted.diagnostics.some(
          (error) => error.category === ts.DiagnosticCategory.Error,
        )
      )
        throw new Error("Framework emit failed.");
    }
    copyRuntimeAssets(before.inputDigest);
    const formats = ["esm"];
    if (!args.includes("--esm")) {
      const { buildCjs } = await import(
        pathToFileURL(path.join(root, "scripts/build-cjs.mjs")).href
      );
      await buildCjs();
      formats.push("cjs");
    }
    completeImplementationBuild(root, before, buildId, formats);
    process.stdout.write(
      "[vext build] Implementation manifest complete (" +
        formats.join(", ") +
        ").\n",
    );
  } finally {
    release();
  }
}
