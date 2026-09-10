import { existsSync } from "node:fs";
import path from "node:path";
import { detectProject } from "./utils/detect-project.js";
import { loadConfig } from "../lib/config-loader.js";
import {
  printConfigProfileWarning,
  resolveConfigProfile,
} from "../lib/config-profile.js";
import {
  deployFrontendAssets,
  FrontendDeployError,
} from "../frontend/deploy/index.js";
import {
  resolveBuildLocation,
  withBuildFrontendOutDir,
} from "../lib/build/build-location.js";
import { resolveFrontendConfig } from "../frontend/tooling/config-resolver.js";
import type {
  ResolvedVextFrontendConfig,
  VextFrontendDeployUploadAdapterName,
} from "../frontend/contract/types.js";
import { readRequiredOptionValue } from "./utils/command-args.js";
import { assertUniqueOption } from "./utils/option-occurrence.js";

interface DeployAssetsCommandOptions {
  outdir?: string;
  manifest?: string;
  dryRun: boolean;
  adapter?: VextFrontendDeployUploadAdapterName;
  targetDir?: string;
  prefix?: string;
  stateFile?: string;
  configProfile?: string;
  json?: boolean;
}

export async function deployCommand(args: string[] = []): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "--help" || subcommand === "-h") {
    printDeployHelp();
    process.exit(0);
  }
  try {
    if (subcommand !== "assets") {
      throw new Error(`[vextjs] Unknown deploy command: "${subcommand ?? ""}"`);
    }
    await deployAssetsCommand(args.slice(1));
  } catch (error) {
    if (args.includes("--json"))
      console.log(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof FrontendDeployError
            ? { result: error.result }
            : {}),
        }),
      );
    else console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function deployAssetsCommand(args: string[]): Promise<void> {
  const options = parseDeployAssetsArgs(args);
  const resolvedConfigProfile = resolveCliConfigProfile(options);
  printConfigProfileWarning(resolvedConfigProfile);
  const rootDir = detectProject(path.resolve(process.cwd())).rootDir;
  const location = resolveBuildLocation(rootDir, options.outdir);
  if (location.failure) throw new Error(`[vextjs] ${location.failure}`);
  const profile =
    resolvedConfigProfile.source === "default"
      ? (location.identity?.profile ?? resolvedConfigProfile.profile)
      : resolvedConfigProfile.profile;
  const builtConfigDir = path.join(location.outDir, "config");
  const isBuilt = existsSync(builtConfigDir);
  const configDir = isBuilt ? builtConfigDir : path.join(rootDir, "src/config");
  const config = await loadConfig(configDir, {
    rootDir,
    command: "build",
    isBuilt,
    mode: "production",
    configProfile: profile,
  });
  const frontend = withBuildFrontendOutDir(config.frontend, location.outDir);
  const resolved = withDeployCliOverrides(
    resolveFrontendConfig(frontend, { rootDir, mode: "production" }),
    rootDir,
    options,
  );
  if (!resolved.enabled) {
    console.log(
      options.json
        ? JSON.stringify({
            ok: true,
            status: "not-present",
            reason: "frontend-disabled",
          })
        : "[vextjs] frontend deploy skipped: frontend is disabled",
    );
    return;
  }
  const manifestPath = options.manifest
    ? path.resolve(rootDir, options.manifest)
    : path.join(resolved.outDir, "deploy-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `[vextjs] frontend deploy manifest not found: ${path.relative(
        rootDir,
        manifestPath,
      )}\nRun "vext build" first, or pass --manifest <path>.`,
    );
  }
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new Error("Frontend deployment cancelled by signal."));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let result;
  try {
    result = await deployFrontendAssets({
      config: resolved,
      manifestPath,
      dryRun: resolved.deploy.upload.dryRun,
      configProfile: profile,
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
  if (options.json) {
    console.log(JSON.stringify({ ok: true, result }));
    return;
  }
  console.log(
    `[vextjs] frontend assets ${result.dryRun ? "planned" : result.simulated ? "simulated" : "uploaded"}`,
  );
  console.log(`[vextjs] manifest: ${path.relative(rootDir, manifestPath)}`);
  console.log(`[vextjs] state:    ${path.relative(rootDir, result.stateFile)}`);
  console.log(`[vextjs] uploaded: ${result.uploaded}`);
  console.log(`[vextjs] skipped:  ${result.skipped}`);
  console.log(`[vextjs] simulated: ${result.simulated}`);
  console.log(
    `[vextjs] target: ${result.targetId ?? "unknown (incremental state disabled)"}`,
  );
  console.log(`[vextjs] bytes:    ${result.bytesUploaded}`);
}

export function parseDeployAssetsArgs(
  args: string[],
): DeployAssetsCommandOptions {
  const options: DeployAssetsCommandOptions = {
    outdir: process.env.VEXT_BUILD_OUTDIR || undefined,
    dryRun: false,
  };
  const seenOptions = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--outdir":
        {
          const parsed = readDeployOptionValue(args, i, arg, "<path>");
          options.outdir = parsed.value;
          i = parsed.nextIndex;
        }
        break;
      case "--manifest":
        {
          const parsed = readDeployOptionValue(args, i, arg, "<path>");
          options.manifest = parsed.value;
          i = parsed.nextIndex;
        }
        break;
      case "--config":
        assertUniqueOption(seenOptions, "--config");
        {
          const parsed = readDeployOptionValue(args, i, arg, "<name>");
          options.configProfile = parsed.value;
          i = parsed.nextIndex;
        }
        break;
      case "--adapter":
        {
          const parsed = readDeployOptionValue(args, i, arg, "<name>");
          options.adapter = parsed.value as VextFrontendDeployUploadAdapterName;
          i = parsed.nextIndex;
        }
        break;
      case "--target-dir":
        {
          const parsed = readDeployOptionValue(args, i, arg, "<path>");
          options.targetDir = parsed.value;
          i = parsed.nextIndex;
        }
        break;
      case "--prefix":
        {
          const parsed = readDeployOptionValue(args, i, arg, "<path>");
          options.prefix = normalizeDeployPrefix(parsed.value);
          i = parsed.nextIndex;
        }
        break;
      case "--state-file":
        {
          const parsed = readDeployOptionValue(args, i, arg, "<path>");
          options.stateFile = parsed.value;
          i = parsed.nextIndex;
        }
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        printDeployAssetsHelp();
        process.exit(0);
        break;
      default:
        throw new Error(
          `[vextjs] Unknown ${arg?.startsWith("-") ? "option" : "argument"}: "${arg}"`,
        );
    }
  }
  return options;
}

function resolveCliConfigProfile(
  options: DeployAssetsCommandOptions,
): ReturnType<typeof resolveConfigProfile> {
  return resolveConfigProfile({
    cliProfile: options.configProfile,
    env: process.env,
    command: "build",
    displayCommand: "deploy assets",
  });
}

function withDeployCliOverrides(
  config: ResolvedVextFrontendConfig,
  rootDir: string,
  options: DeployAssetsCommandOptions,
): ResolvedVextFrontendConfig {
  return {
    ...config,
    deploy: {
      ...config.deploy,
      upload: {
        ...config.deploy.upload,
        adapter: options.adapter ?? config.deploy.upload.adapter,
        targetDir: options.targetDir
          ? path.resolve(rootDir, options.targetDir)
          : config.deploy.upload.targetDir,
        prefix: options.prefix ?? config.deploy.upload.prefix,
        stateFile: options.stateFile
          ? path.resolve(rootDir, options.stateFile)
          : config.deploy.upload.stateFile,
        dryRun: options.dryRun || config.deploy.upload.dryRun,
      },
    },
  };
}

function readDeployOptionValue(
  args: string[],
  index: number,
  optionName: string,
  valueLabel: string,
) {
  return readRequiredOptionValue(args, index, optionName, valueLabel);
}

function normalizeDeployPrefix(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+|\/+$/gu, "");
  if (normalized.includes("..")) {
    throw new Error("[vextjs] --prefix must not contain '..'.");
  }
  return normalized;
}

function printDeployHelp(): void {
  console.log(`
  Usage: vext deploy <command> [options]

  Commands:
    assets                Upload frontend static assets from deploy-manifest.json

  Examples:
    $ vext deploy assets
    $ vext deploy assets --config sg-sit
    $ vext deploy assets --dry-run
`);
}

function printDeployAssetsHelp(): void {
  console.log(`
  Usage: vext deploy assets [options]

  Positional arguments are not supported.
  Options that take values require a non-option value.

  Options:
    --outdir <path>       Build output directory (default: recorded build location, then "dist")
    --config <name>       Load config profile for frontend deploy settings
    --manifest <path>     Deploy manifest path
    --adapter <name>      Upload adapter: filesystem, mock, or custom adapter name
    --target-dir <path>   Filesystem adapter target directory
    --prefix <path>       Upload key prefix
    --state-file <path>   Incremental deploy state file
    --dry-run             Print upload plan without writing assets
    --json                Print the result and confirmed/unknown per-asset outcomes as JSON
    -h, --help            Show this help message

  Examples:
    $ vext deploy assets
    $ vext deploy assets --config sg-sit
    $ vext deploy assets --dry-run
    $ vext deploy assets --adapter filesystem --target-dir .deploy/cdn
`);
}
