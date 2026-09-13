import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

import { VEXT_MCP_SKILL_CONTENT } from "../../assistant/skill.js";
import type { VextMcpHostSyncPlan, VextMcpHostSyncTarget } from "./plan.js";

export interface VextMcpHostSyncApplyResult {
  schemaVersion: 1;
  status: "ok" | "partial";
  launcher: VextMcpWrittenFile;
  state: VextMcpWrittenFile;
  targets: VextMcpHostSyncApplyTarget[];
  skills: VextMcpHostSkillApplyTarget[];
  nextSteps: VextMcpHostSyncNextStep[];
}

export interface VextMcpWrittenFile {
  path: string;
  status: "written" | "up-to-date";
}

export interface VextMcpHostSyncApplyTarget {
  host: string;
  configPath: string;
  status: "written" | "up-to-date" | "blocked";
  verified: boolean;
  verification: string;
  reason: string;
}

export interface VextMcpHostSkillApplyTarget {
  host: string;
  path: string;
  status: "written" | "up-to-date" | "blocked";
  verified: boolean;
  reason: string;
}

export interface VextMcpHostSyncNextStep {
  host: string;
  reason: "config-written" | "launcher-written" | "skill-written";
  summary: string;
  steps: string[];
  validation: string[];
}

export async function applyVextMcpHostSyncPlan(
  plan: VextMcpHostSyncPlan,
): Promise<VextMcpHostSyncApplyResult> {
  const launcher = await writeIfChanged(
    plan.launcher.absolutePath,
    plan.launcher.content,
  );
  const statePath = path.join(plan.rootDir, ".vext", "mcp", "hosts.json");
  const state = await writeIfChanged(statePath, createStateContent(plan));
  const targets: VextMcpHostSyncApplyTarget[] = [];
  for (const target of plan.targets) {
    targets.push(await applyTarget(plan, target));
  }
  const skills: VextMcpHostSkillApplyTarget[] = [];
  if (plan.skill.include) {
    for (const target of plan.targets) {
      skills.push(await applySkillTarget(plan, target));
    }
  }
  return {
    schemaVersion: 1,
    status:
      targets.some(
        (target) => target.status === "blocked" || !target.verified,
      ) || skills.some((skill) => skill.status === "blocked" || !skill.verified)
        ? "partial"
        : "ok",
    launcher,
    state,
    targets,
    skills,
    nextSteps: createNextSteps(plan, launcher, targets, skills),
  };
}

async function applyTarget(
  plan: VextMcpHostSyncPlan,
  target: VextMcpHostSyncTarget,
): Promise<VextMcpHostSyncApplyTarget> {
  const absolutePath = path.join(plan.rootDir, target.configPath);
  if (target.configFormat === "toml") {
    return await applyTomlTarget(absolutePath, target);
  }
  const current = await readOptionalText(absolutePath);
  const source = current ?? "{}\n";
  const errors: ParseError[] = [];
  parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    return {
      host: target.host,
      configPath: target.configPath,
      status: "blocked",
      verified: false,
      verification: "JSON/JSONC parse failed before write.",
      reason: "Host config is not valid JSON/JSONC; it was not modified.",
    };
  }
  const edits = modify(
    source,
    [target.configRootKey, target.entryKey],
    {
      command: target.command,
      args: target.args,
    },
    {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
      getInsertionIndex: (properties) => properties.length,
    },
  );
  const next = applyEdits(source, edits);
  const written = await writeIfChanged(
    absolutePath,
    next.endsWith("\n") ? next : `${next}\n`,
  );
  const verified = await verifyJsonTarget(absolutePath, target);
  return {
    host: target.host,
    configPath: target.configPath,
    status: written.status,
    verified,
    verification: verified
      ? "Read-back confirmed JSON/JSONC managed entry."
      : "Read-back did not find the expected JSON/JSONC managed entry.",
    reason: verified
      ? "Managed MCP server entry written with JSONC structural edits."
      : "Managed MCP server entry was written but read-back verification failed.",
  };
}

async function applyTomlTarget(
  absolutePath: string,
  target: VextMcpHostSyncTarget,
): Promise<VextMcpHostSyncApplyTarget> {
  const current = await readOptionalText(absolutePath);
  const source = current ?? "";
  const next = createTomlManagedEntry(source, target);
  if (next.status === "blocked") {
    return {
      host: target.host,
      configPath: target.configPath,
      status: "blocked",
      verified: false,
      verification: "TOML managed block preflight failed before write.",
      reason: next.reason,
    };
  }
  const written = await writeIfChanged(absolutePath, next.content);
  const verified = await verifyTomlTarget(absolutePath, target);
  return {
    host: target.host,
    configPath: target.configPath,
    status: written.status,
    verified,
    verification: verified
      ? "Read-back confirmed TOML managed block."
      : "Read-back did not find the expected TOML managed block.",
    reason: verified
      ? "Managed MCP server entry written with TOML managed-block edits."
      : "Managed MCP server entry was written but read-back verification failed.",
  };
}

async function applySkillTarget(
  plan: VextMcpHostSyncPlan,
  target: VextMcpHostSyncTarget,
): Promise<VextMcpHostSkillApplyTarget> {
  const absolutePath = path.join(plan.rootDir, target.skillPath);
  const content = `${VEXT_MCP_SKILL_CONTENT.trimEnd()}\n`;
  const current = await readOptionalText(absolutePath);
  if (current !== null && current !== content) {
    return {
      host: target.host,
      path: target.skillPath,
      status: "blocked",
      verified: false,
      reason:
        "Skill file already exists with different content; it was not modified.",
    };
  }
  const written = await writeIfChanged(absolutePath, content);
  const verified = (await readOptionalText(absolutePath)) === content;
  return {
    host: target.host,
    path: target.skillPath,
    status: written.status,
    verified,
    reason: verified
      ? "Bundled project-local Skill file is present."
      : "Skill file was written but read-back verification failed.",
  };
}

async function writeIfChanged(
  filePath: string,
  content: string,
): Promise<VextMcpWrittenFile> {
  const current = await readOptionalText(filePath);
  if (current === content) return { path: filePath, status: "up-to-date" };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return { path: filePath, status: "written" };
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function createStateContent(plan: VextMcpHostSyncPlan): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      serviceKey: plan.serviceKey,
      rootDir: plan.rootDir,
      projectId: plan.projectId,
      contextRevision: plan.contextRevision,
      launcher: {
        path: plan.launcher.path,
        sha256: plan.launcher.sha256,
      },
      targets: plan.targets.map((target) => ({
        host: target.host,
        configPath: target.configPath,
        configRootKey: target.configRootKey,
        entryKey: target.entryKey,
        configFormat: target.configFormat,
        command: target.command,
        args: target.args,
        refresh: target.refresh,
      })),
      skills: plan.skill,
    },
    null,
    2,
  )}\n`;
}

function createNextSteps(
  plan: VextMcpHostSyncPlan,
  launcher: VextMcpWrittenFile,
  targets: VextMcpHostSyncApplyTarget[],
  skills: VextMcpHostSkillApplyTarget[],
): VextMcpHostSyncNextStep[] {
  const steps: VextMcpHostSyncNextStep[] = [];
  const launcherChanged = launcher.status === "written";
  for (const target of plan.targets) {
    const targetResult = targets.find((result) => result.host === target.host);
    if (
      !targetResult ||
      targetResult.status === "blocked" ||
      !targetResult.verified
    ) {
      continue;
    }
    const configChanged = targets.some(
      (result) => result.host === target.host && result.status === "written",
    );
    const skillChanged = skills.some(
      (result) => result.host === target.host && result.status === "written",
    );
    if (!configChanged && !launcherChanged && !skillChanged) continue;
    steps.push({
      host: target.host,
      reason: configChanged
        ? "config-written"
        : launcherChanged
          ? "launcher-written"
          : "skill-written",
      summary: target.refresh.summary,
      steps: target.refresh.steps,
      validation: target.refresh.validation,
    });
  }
  return steps;
}

function createTomlManagedEntry(
  source: string,
  target: VextMcpHostSyncTarget,
): { status: "ok"; content: string } | { status: "blocked"; reason: string } {
  const begin = `# BEGIN VEXT MCP MANAGED ${target.entryKey}`;
  const end = `# END VEXT MCP MANAGED ${target.entryKey}`;
  const hasBegin = source.includes(begin);
  const hasEnd = source.includes(end);
  if (hasBegin !== hasEnd) {
    return {
      status: "blocked",
      reason:
        "Host TOML config contains an incomplete Vext managed block; it was not modified.",
    };
  }
  const block = createTomlManagedBlock(target, begin, end);
  if (hasBegin) {
    const beginIndex = source.indexOf(begin);
    const endIndex = source.indexOf(end, beginIndex);
    if (source.indexOf(begin, beginIndex + begin.length) !== -1) {
      return {
        status: "blocked",
        reason:
          "Host TOML config contains multiple Vext managed blocks for the same entry; it was not modified.",
      };
    }
    const replaceEnd = endIndex + end.length;
    const includeTrailingNewline =
      source.slice(replaceEnd, replaceEnd + 2) === "\r\n"
        ? 2
        : source.slice(replaceEnd, replaceEnd + 1) === "\n"
          ? 1
          : 0;
    return {
      status: "ok",
      content:
        source.slice(0, beginIndex) +
        block +
        source.slice(replaceEnd + includeTrailingNewline),
    };
  }
  if (hasTomlMcpServerTable(source, target.entryKey)) {
    return {
      status: "blocked",
      reason:
        "Host TOML config already contains an unmanaged table for this MCP server key; it was not modified.",
    };
  }
  const separator =
    source.trim().length === 0 ? "" : source.endsWith("\n") ? "\n" : "\n\n";
  return { status: "ok", content: `${source}${separator}${block}` };
}

function createTomlManagedBlock(
  target: VextMcpHostSyncTarget,
  begin: string,
  end: string,
): string {
  return `${begin}
[${target.configRootKey}.${tomlQuotedString(target.entryKey)}]
command = ${tomlQuotedString(target.command)}
args = [${target.args.map(tomlQuotedString).join(", ")}]
${end}
`;
}

async function verifyJsonTarget(
  absolutePath: string,
  target: VextMcpHostSyncTarget,
): Promise<boolean> {
  const source = await readOptionalText(absolutePath);
  if (source === null) return false;
  const errors: ParseError[] = [];
  const config = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0 || !isRecord(config)) return false;
  const root = config[target.configRootKey];
  if (!isRecord(root)) return false;
  const entry = root[target.entryKey];
  return (
    isRecord(entry) &&
    entry.command === target.command &&
    Array.isArray(entry.args) &&
    entry.args.length === target.args.length &&
    entry.args.every((arg, index) => arg === target.args[index])
  );
}

async function verifyTomlTarget(
  absolutePath: string,
  target: VextMcpHostSyncTarget,
): Promise<boolean> {
  const source = await readOptionalText(absolutePath);
  if (source === null) return false;
  const begin = `# BEGIN VEXT MCP MANAGED ${target.entryKey}`;
  const end = `# END VEXT MCP MANAGED ${target.entryKey}`;
  return source.includes(createTomlManagedBlock(target, begin, end));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasTomlMcpServerTable(source: string, entryKey: string): boolean {
  const escaped = escapeRegExp(entryKey);
  return new RegExp(
    String.raw`^\s*\[\s*mcp_servers\s*\.\s*(?:"${escaped}"|${escaped})\s*\]\s*(?:#.*)?$`,
    "m",
  ).test(source);
}

function tomlQuotedString(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
