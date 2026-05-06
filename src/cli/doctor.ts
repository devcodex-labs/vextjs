import { detectProject } from "./utils/detect-project.js";

interface DoctorOptions {
  target: "routes" | "all";
  rootDir: string;
  json: boolean;
  writeInspect: boolean;
  writeManifest: boolean;
  help: boolean;
}

export async function doctorCommand(args: string[] = []): Promise<void> {
  const options = parseDoctorArgs(args);

  if (options.help) {
    printDoctorHelp();
    return;
  }

  const project = detectProject(options.rootDir);
  const { runDoctor } = await import("../tooling/doctor/index.js");
  const result = await runDoctor({
    rootDir: project.rootDir,
    target: options.target,
    writeInspect: options.writeInspect,
    writeManifest: options.writeManifest,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `[vext doctor] target=${result.target} routeFiles=${result.routeFileCount} routes=${result.routeCount} errors=${result.summary.errors} warnings=${result.summary.warnings} infos=${result.summary.infos}`,
    );

    if (result.inspect) {
      console.log(
        `[vext doctor] inspect=${result.inspect.filePath} (${result.inspect.status})`,
      );
    }

    if (result.manifest) {
      console.log(
        `[vext doctor] manifest=${result.manifest.filePath} (${result.manifest.status})`,
      );
    }

    for (const diagnostic of result.diagnostics) {
      const location = diagnostic.filePath
        ? ` (${diagnostic.filePath}${diagnostic.path ? ` -> ${diagnostic.path}` : ""})`
        : "";
      const suggestion = diagnostic.suggestedValue
        ? ` -> suggested: ${diagnostic.suggestedValue}`
        : "";
      const logger = diagnostic.level === "error" ? console.error : console.warn;
      logger(
        `[vext doctor] ${diagnostic.level}/${diagnostic.group}: ${diagnostic.message}${location}${suggestion}`,
      );
    }
  }

  if (!result.ok) {
    throw new Error(
      "[vextjs] doctor found blocking issues. Resolve the reported diagnostics and try again.",
    );
  }
}

function parseDoctorArgs(args: string[]): DoctorOptions {
  const options: DoctorOptions = {
    target: "routes",
    rootDir: process.cwd(),
    json: false,
    writeInspect: false,
    writeManifest: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg) continue;

    if (arg === "routes" || arg === "all") {
      options.target = arg;
    } else if ((arg === "--root" || arg === "-C") && i + 1 < args.length) {
      options.rootDir = args[++i]!;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--write-inspect") {
      options.writeInspect = true;
    } else if (arg === "--write-manifest") {
      options.writeManifest = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`[vextjs] Unknown option: "${arg}"`);
    } else {
      throw new Error(`[vextjs] Unknown doctor target: "${arg}"`);
    }
  }

  return options;
}

function printDoctorHelp(): void {
  console.log(`
  Usage: vext doctor <target> [options]

  Preview tooling-only diagnostics (experimental).

  Targets:
    routes              Analyze static route metadata and duplicate definitions
    all                 Alias of routes for Phase 2 bootstrap

  Options:
    --json              Print machine-readable JSON output
    --write-inspect     Write .vext/inspect/routes.json for downstream tooling
    --write-manifest    Write .vext/inspect/routes.manifest.json for stable tooling consumers
    --root <path>       Project root directory (default: current working directory)
    -C <path>           Alias of --root
    -h, --help          Show this help message

  Examples:
    $ vext doctor routes
    $ vext doctor routes --write-inspect
    $ vext doctor routes --write-manifest
    $ vext doctor routes --json --root ./examples/hello-world
  `);
}

