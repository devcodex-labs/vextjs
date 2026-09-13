import { createHash } from "node:crypto";
import path from "node:path";

import type { VextMcpHostId } from "../../assistant/contracts.js";
import {
  inspectVextProject,
  type VextMcpProjectInspection,
} from "../../assistant/project-inspector.js";
import {
  VEXT_MCP_HOST_REGISTRY,
  type VextMcpHostDescriptor,
} from "./registry.js";

export interface VextMcpHostSyncPlanOptions {
  rootDir: string;
  frameworkVersion: string;
  host?: VextMcpHostId;
  mode: "check" | "dry-run" | "write";
}

export interface VextMcpHostSyncPlan {
  schemaVersion: 1;
  status: "ok" | "blocked";
  mode: "check" | "dry-run" | "write";
  rootDir: string;
  projectId: string;
  contextRevision: string | null;
  serviceKey: string;
  launcher: {
    path: string;
    absolutePath: string;
    sha256: string;
    content: string;
  };
  declared: {
    enabled: boolean;
    sync: string;
    hosts: VextMcpHostId[];
    sources: string[];
  };
  targets: VextMcpHostSyncTarget[];
  warnings: string[];
}

export interface VextMcpHostSyncTarget {
  host: VextMcpHostId;
  configPath: string;
  configRootKey: string;
  configFormat: VextMcpHostDescriptor["configFormat"];
  skillPath: string;
  entryKey: string;
  command: string;
  args: string[];
  localOnly: boolean;
  action: "plan-managed-entry" | "write-managed-entry" | "blocked";
  reason: string;
  notes: string[];
}

export function createVextMcpHostSyncPlan(
  options: VextMcpHostSyncPlanOptions,
): VextMcpHostSyncPlan {
  const project = inspectVextProject({
    rootDir: options.rootDir,
    frameworkVersion: options.frameworkVersion,
  });
  const rootDir = project.identity.rootDir;
  const serviceKey = createServiceKey(project);
  const launcherPath = path.join(".vext", "mcp", "launcher.cjs");
  const launcherAbsolutePath = path.join(rootDir, launcherPath);
  const launcherContent = createLauncherContent();
  const warnings: string[] = [];
  const declaredHosts = project.assistant.devMcp.hosts;
  const selectedHosts = options.host ? [options.host] : declaredHosts;

  if (!project.assistant.devMcp.declared) {
    warnings.push("dev.mcp is not declared; host sync plan is a no-op.");
  } else if (!project.assistant.devMcp.enabled) {
    warnings.push("dev.mcp is disabled; host sync plan is a no-op.");
  } else if (project.assistant.devMcp.sync === "off") {
    warnings.push("dev.mcp.sync is off; host sync plan is a no-op.");
  } else if (declaredHosts.length === 0) {
    warnings.push("dev.mcp.hosts is empty; no host target is selected.");
  }
  if (options.host && !declaredHosts.includes(options.host)) {
    warnings.push(
      `--host ${options.host} is not declared in dev.mcp.hosts; no host target is selected.`,
    );
  }

  const targets =
    project.assistant.devMcp.declared &&
    project.assistant.devMcp.enabled &&
    project.assistant.devMcp.sync !== "off"
      ? selectedHosts
          .filter((host) => declaredHosts.includes(host))
          .map((host) =>
            createTarget({
              host,
              descriptor: VEXT_MCP_HOST_REGISTRY[host],
              rootDir,
              serviceKey,
              launcherAbsolutePath,
            }),
          )
      : [];

  return {
    schemaVersion: 1,
    status: "ok",
    mode: options.mode,
    rootDir,
    projectId: project.identity.projectId,
    contextRevision: project.identity.contextRevision,
    serviceKey,
    launcher: {
      path: launcherPath,
      absolutePath: launcherAbsolutePath,
      sha256: sha256(launcherContent),
      content: launcherContent,
    },
    declared: {
      enabled: project.assistant.devMcp.enabled,
      sync: project.assistant.devMcp.sync,
      hosts: declaredHosts,
      sources: project.assistant.devMcpSources,
    },
    targets,
    warnings,
  };
}

function createTarget(input: {
  host: VextMcpHostId;
  descriptor: VextMcpHostDescriptor;
  rootDir: string;
  serviceKey: string;
  launcherAbsolutePath: string;
}): VextMcpHostSyncTarget {
  return {
    host: input.host,
    configPath: input.descriptor.configPath,
    configRootKey: input.descriptor.configRootKey,
    configFormat: input.descriptor.configFormat,
    skillPath: input.descriptor.skillPath,
    entryKey: input.serviceKey,
    command: "node",
    args: [input.launcherAbsolutePath, "mcp", "--root", input.rootDir],
    localOnly: true,
    action:
      input.descriptor.configFormat === "json"
        ? "write-managed-entry"
        : "plan-managed-entry",
    reason:
      input.descriptor.configFormat === "json"
        ? "JSON/JSONC host config can be written by vext mcp sync; TOML hosts remain plan-only in this batch."
        : "TOML host config remains dry-run/check only in this batch to avoid lossy comment-preservation behavior.",
    notes: [input.descriptor.notes],
  };
}

function createServiceKey(project: VextMcpProjectInspection): string {
  const rawName =
    project.assistant.workspace?.config.services?.[0]?.id ??
    project.identity.packageName ??
    path.basename(project.identity.rootDir);
  const name = rawName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `vext-${name || "service"}-${project.identity.projectId.slice(0, 8)}`;
}

function createLauncherContent(): string {
  return `#!/usr/bin/env node
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function main() {
  const cli = path.resolve(__dirname, "..", "..", "node_modules", "vextjs", "dist", "cli", "index.js");
  await import(pathToFileURL(cli).href);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
