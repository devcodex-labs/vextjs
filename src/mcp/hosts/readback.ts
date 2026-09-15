import path from "node:path";
import { resolvePathInside } from "../../lib/path-boundary.js";
import { parse, type ParseError } from "jsonc-parser";
import { readProjectFile } from "../../lib/project/read-project-file.js";
import {
  VEXT_MCP_SKILL_CONTENT,
  getVextMcpSkillManifest,
} from "../../assistant/skill.js";
import type { VextMcpHostSyncPlan, VextMcpHostSyncTarget } from "./plan.js";

/** 只读显式宿主目标；不返回宿主配置正文，也不把文件存在当作宿主采用证据。 */
export async function inspectHostAdoption(
  plan: Pick<VextMcpHostSyncPlan, "rootDir" | "targets" | "launcher">,
) {
  return Promise.all(
    plan.targets.map(async (target) => {
      const configPath =
        target.configScope === "user"
          ? target.configPath
          : path.join(plan.rootDir, target.configPath);
      const configuration = await inspectExpectedFile(
        () => resolveTargetConfigPath(plan, target),
        (source) => matchesHostTarget(source, target),
      );
      const skill = await inspectExpectedFile(
        () =>
          resolvePathInside(plan.rootDir, target.skillPath, "host Skill", {
            realpath: true,
          }),
        (source) => source === `${VEXT_MCP_SKILL_CONTENT.trimEnd()}\n`,
      );
      const launcher = await inspectExpectedFile(
        () =>
          resolvePathInside(
            plan.rootDir,
            path.relative(plan.rootDir, plan.launcher.absolutePath),
            "host launcher",
            { realpath: true },
          ),
        (source) => source === plan.launcher.content,
      );
      return {
        host: target.host,
        configuration: {
          ...configuration,
          path: configPath,
          evidence:
            target.configFormat === "json"
              ? "jsonc-structure"
              : "toml-managed-block-only",
          hostParse: "unverified" as const,
        },
        launcher,
        skill: {
          ...skill,
          path: target.skillPath,
          metadata:
            skill.state === "matched" ? getVextMcpSkillManifest() : null,
          discovery: "unverified" as const,
        },
        connection: {
          state: "unverified" as const,
          nextStep:
            "In the host, call vext_project_inspect and compare rootDir, projectId and implementation.loadedDigest with this CLI inspection.",
        },
        taskUsage: {
          state: "unverified" as const,
          nextStep:
            "Check the current host task's actual MCP tool results; configuration and Skill read-back do not prove task usage.",
        },
      };
    }),
  );
}

export function resolveTargetConfigPath(
  plan: Pick<VextMcpHostSyncPlan, "rootDir">,
  target: VextMcpHostSyncTarget,
): string {
  return target.configScope === "user"
    ? target.configPath
    : resolvePathInside(
        plan.rootDir,
        target.configPath,
        "project host config",
        { realpath: true },
      );
}

export function readOptionalHostText(filePath: string): string | null {
  const bytes = readProjectFile(
    path.dirname(filePath),
    path.basename(filePath),
    1024 * 1024,
  );
  return bytes === null
    ? null
    : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function matchesHostTarget(
  source: string,
  target: VextMcpHostSyncTarget,
): boolean {
  if (target.configFormat === "toml") {
    const block = createTomlManagedBlock(target);
    const normalized = source.replace(/\r\n/g, "\n");
    // Exact complete managed lines only. This is deliberately not a whole TOML parser.
    return (
      `\n${normalized}`.includes(`\n${block}`) &&
      normalized.split(`# BEGIN VEXT MCP MANAGED ${target.entryKey}`).length ===
        2
    );
  }
  const errors: ParseError[] = [];
  const config: unknown = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length || !isRecord(config)) return false;
  const root = config[target.configRootKey];
  const entry = isRecord(root) ? root[target.entryKey] : null;
  return (
    isRecord(entry) &&
    entry.command === target.command &&
    Array.isArray(entry.args) &&
    entry.args.length === target.args.length &&
    entry.args.every((arg, index) => arg === target.args[index])
  );
}

export function createTomlManagedBlock(target: VextMcpHostSyncTarget): string {
  const quote = (value: string) =>
    JSON.stringify(value)
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  return `# BEGIN VEXT MCP MANAGED ${target.entryKey}\n[${target.configRootKey}.${quote(target.entryKey)}]\ncommand = ${quote(target.command)}\nargs = [${target.args.map(quote).join(", ")}]\n# END VEXT MCP MANAGED ${target.entryKey}\n`;
}

async function inspectExpectedFile(
  filePath: string | (() => string),
  matches: (source: string) => boolean,
) {
  try {
    const source = readOptionalHostText(
      typeof filePath === "string" ? filePath : filePath(),
    );
    return {
      state:
        source === null
          ? ("missing" as const)
          : matches(source)
            ? ("matched" as const)
            : ("different" as const),
      reason: null,
    };
  } catch (error) {
    return {
      state: "unverified" as const,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
