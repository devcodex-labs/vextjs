import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

import type { VextMcpHostSyncPlan, VextMcpHostSyncTarget } from "./plan.js";

export interface VextMcpHostSyncApplyResult {
  schemaVersion: 1;
  status: "ok" | "partial";
  launcher: VextMcpWrittenFile;
  state: VextMcpWrittenFile;
  targets: VextMcpHostSyncApplyTarget[];
}

export interface VextMcpWrittenFile {
  path: string;
  status: "written" | "up-to-date";
}

export interface VextMcpHostSyncApplyTarget {
  host: string;
  configPath: string;
  status: "written" | "up-to-date" | "planned-only" | "blocked";
  reason: string;
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
  return {
    schemaVersion: 1,
    status: targets.some(
      (target) =>
        target.status === "planned-only" || target.status === "blocked",
    )
      ? "partial"
      : "ok",
    launcher,
    state,
    targets,
  };
}

async function applyTarget(
  plan: VextMcpHostSyncPlan,
  target: VextMcpHostSyncTarget,
): Promise<VextMcpHostSyncApplyTarget> {
  if (target.configFormat !== "json") {
    return {
      host: target.host,
      configPath: target.configPath,
      status: "planned-only",
      reason: target.reason,
    };
  }
  const absolutePath = path.join(plan.rootDir, target.configPath);
  const current = await readOptionalText(absolutePath);
  const source = current ?? "{}\n";
  const errors: ParseError[] = [];
  parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    return {
      host: target.host,
      configPath: target.configPath,
      status: "blocked",
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
  return {
    host: target.host,
    configPath: target.configPath,
    status: written.status,
    reason: "Managed MCP server entry written with JSONC structural edits.",
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
      })),
    },
    null,
    2,
  )}\n`;
}
