import path from "node:path";
import { buildProjectIndexFromSourceView } from "../tooling/project-index/index.js";
import {
  projectConventionSourceView,
  type ProjectSourceOptions,
} from "../tooling/project-index/source-input.js";
import { analyzeIndexedServiceDependencies } from "../tooling/diagnostics/service-deps.js";
import { StaticModuleGraph } from "../tooling/project-index/static-module-graph.js";
import { inspectRouteFacts } from "../tooling/project-index/route-facts.js";
import { buildRouteIndexFromSourceView } from "../tooling/project-index/scan-routes.js";
import { createStaticModuleFromText } from "../tooling/project-index/static-module-graph.js";
import {
  staticFact,
  readStaticExpression,
  unwrapStaticExpression,
} from "../tooling/project-index/static-values.js";
import {
  normalizeRegisteredRoutePath,
  projectRouteFilePrefix,
} from "../lib/route-contract.js";
import {
  getInspectionSources,
  getInspectionConfig,
  inspectVextProjectJobDetails,
  type VextMcpProjectInspection,
} from "./project-inspector.js";
import { ASSISTANT_SOURCE_ROOT } from "../tooling/project-index/analysis-source.js";
import { isInRole } from "../tooling/project-index/roles.js";

export interface AssistantSectionProjection {
  state: "complete" | "partial" | "absent";
  items: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  missingEvidence: string[];
}

/** 所有明细以本次封存字节为依据；资源和 Tool 共用投影，不把默认目录表当成实际代码。 */
export function projectAssistantSection(
  project: VextMcpProjectInspection,
  section: string,
): AssistantSectionProjection {
  const source = getInspectionSources(project);
  const result: AssistantSectionProjection = {
    state: source ? "complete" : "partial",
    items: [],
    metadata: {},
    missingEvidence: source ? [] : ["Project source snapshot is unavailable."],
  };
  if (!source) return result;
  if (project.snapshot.sections[section]?.state === "unknown")
    result.missingEvidence.push(...project.snapshot.sections[section]!.notes);
  const directory = (role: string) =>
    project.snapshot.sections[role]?.resolvedPath;
  const options: ProjectSourceOptions = {
    rootId: ASSISTANT_SOURCE_ROOT,
    directories: {
      route: directory("routes"),
      service: directory("services"),
      plugin: directory("plugins"),
    },
  };
  const view = projectConventionSourceView(
    source,
    project.identity.rootDir,
    options,
  );
  const records = source.list();
  const workspace = project.assistant.workspace?.config;
  try {
    if (section === "routes") {
      const graph = new StaticModuleGraph(view);
      const routeDir = path.join(
        project.identity.rootDir,
        directory("routes")!,
      );
      let indexed: ReturnType<typeof buildRouteIndexFromSourceView> = [];
      try {
        indexed = buildRouteIndexFromSourceView(
          project.identity.rootDir,
          view,
          options,
        );
      } catch (error) {
        result.missingEvidence.push(String(error));
      }
      for (const file of view.list({
        rootId: ASSISTANT_SOURCE_ROOT,
        roles: ["route"],
      })) {
        const facts = inspectRouteFacts(
          file.path,
          view.read(file.rootId, file.path)!,
          { graph, rootId: file.rootId },
        );
        if (facts.state !== "complete")
          result.missingEvidence.push(`${file.path}: ${facts.reason}`);
        const prefix = projectRouteFilePrefix(
          path.join(project.identity.rootDir, file.path),
          routeDir,
        );
        for (const fact of facts.routes) {
          const routePath =
            fact.subPath === null
              ? null
              : normalizeRegisteredRoutePath(prefix, fact.subPath);
          const contract = indexed.find(
            (entry) =>
              entry.fileRelativePath === file.path &&
              entry.method.toUpperCase() === fact.method &&
              entry.path === routePath,
          );
          result.items.push({
            key: `${file.path}:${String(fact.start).padStart(10, "0")}`,
            sourceFile: file.path,
            prefix,
            path: routePath,
            ...fact,
            schema: contract?.schema ?? null,
            freshness: contract?.freshness ?? null,
          });
          if (
            fact.subPath === null ||
            fact.responses === "unknown" ||
            (fact.returnsJson === null && fact.responses === "absent")
          )
            result.missingEvidence.push(
              `${file.path}:${fact.start}: Dynamic route contract needs host evidence.`,
            );
        }
      }
    } else if (
      section === "services" ||
      section === "serviceDependencies" ||
      section === "plugins"
    ) {
      const index = buildProjectIndexFromSourceView(
        project.identity.rootDir,
        view,
        options,
      );
      const dependencies = analyzeIndexedServiceDependencies(index);
      if (section === "plugins") {
        result.items = index.appExtensions.map((entry) => ({
          ...entry,
          key: entry.propertyKey,
          sourceFile: relativeSource(project, entry.pluginFile),
        }));
        for (const file of view.list({ roles: ["plugin"] }))
          if (!result.items.some((entry) => entry.sourceFile === file.path))
            result.items.push({
              key: file.path,
              sourceFile: file.path,
              extensions: [],
              projection: "no-static-extension",
            });
        result.missingEvidence.push(
          ...(index.appExtensionIncompleteFiles ?? []).map(
            (file) =>
              `${relativeSource(project, file)}: Plugin extension projection is incomplete.`,
          ),
        );
      } else {
        result.items = index.serviceEntries.map((entry) => ({
          key: entry.serviceKey,
          serviceKey: entry.serviceKey,
          keySegments: entry.keySegments,
          sourceFile: relativeSource(project, entry.filePath),
          callPath: "app.services." + entry.serviceKey,
          dependencies: [
            ...(dependencies.graph.get(entry.serviceKey) ?? []),
          ].sort(),
        }));
        result.missingEvidence.push(
          ...dependencies.incompleteFiles.map(
            (file) =>
              `${relativeSource(project, file)}: Service dependencies are not fully static.`,
          ),
        );
        result.metadata.diagnostics = dependencies.diagnostics.map((item) => ({
          ...item,
          sourceFile: relativeSource(project, item.sourceFile),
        }));
        result.metadata.workspaceServices = workspace?.services ?? [];
        result.metadata.sharedPackages = workspace?.sharedPackages ?? [];
      }
    } else if (section === "config") {
      const config = getInspectionConfig(project);
      result.metadata = {
        devMcp: project.assistant.devMcp,
        devMcpState: project.assistant.devMcpState,
        devMcpSources: project.assistant.devMcpSources,
        profile: config?.profile,
        mode: config?.mode,
        providerState: config?.providerState,
        workspaceConfig: project.assistant.workspace,
      };
      for (const field of [
        "port",
        "host",
        "adapter",
        "database",
        "rateLimit",
        "cache",
        "session",
        "jobs",
        "frontend",
        "openapi",
        "locale",
        "middlewares",
        "dev",
      ]) {
        const fact = config?.field(field);
        result.items.push({
          key: field,
          field,
          ...(fact ?? { state: "unknown" }),
        });
        if (!fact || fact.state === "unknown" || fact.state === "invalid")
          result.missingEvidence.push(
            `${field}: ${fact?.reason ?? "Configuration is unavailable."}`,
          );
      }
    } else if (section === "scripts") {
      const pkg = JSON.parse(
        source.read(ASSISTANT_SOURCE_ROOT, "package.json") ?? "{}",
      );
      const scripts: unknown = pkg.scripts;
      if (scripts && typeof scripts === "object" && !Array.isArray(scripts))
        result.items = Object.entries(scripts).map(([name, command]) => ({
          key: name,
          name,
          command,
          sourceFile: "package.json",
          execution: "not-run",
        }));
      result.metadata.packageManager = project.snapshot.packageManager;
      result.metadata.policyScripts = project.policy.patch.scripts ?? {};
    } else if (section === "ownership" || section === "structure") {
      result.items = project.structureDecisions.map((entry) => ({
        key: entry.role,
        ...entry,
        loading: project.snapshot.sections[entry.role]?.loading,
      }));
      result.metadata.workspace = project.assistant.workspace;
      result.metadata.policy = project.policy;
    } else if (section === "jobs") {
      const details = inspectVextProjectJobDetails(project);
      const { jobs, ...metadata } = details;
      result.items = jobs.map((job, position) => ({
        ...job,
        key: String(position).padStart(10, "0"),
      }));
      result.metadata = metadata;
      result.missingEvidence.push(...details.warnings);
    } else {
      const selectedRoles =
        section === "frontend"
          ? Object.keys(project.snapshot.sections).filter((role) =>
              role.startsWith("frontend"),
            )
          : [section];
      const directories = selectedRoles.flatMap((role) =>
        directory(role) ? [directory(role)!] : [],
      );
      result.items = records
        .filter((file) =>
          project.snapshot.sections[section]?.readRootId &&
          project.snapshot.sections[section]!.readRootId !==
            ASSISTANT_SOURCE_ROOT
            ? file.rootId === project.snapshot.sections[section]!.readRootId
            : file.rootId === ASSISTANT_SOURCE_ROOT &&
              (directories.some((dir) => isInRole(file.path, dir)) ||
                (section === "frontend" && file.role.startsWith("frontend"))),
        )
        .map((file) => {
          const entry: Record<string, unknown> = {
            key: file.rootId + ":" + file.path,
            rootId: file.rootId,
            sourceFile: file.path,
            role: file.role,
            sha256: file.sha256,
            byteLength: file.byteLength,
          };
          if (
            /\.[cm]?[jt]sx?$/u.test(file.path) &&
            !file.path.endsWith(".d.ts")
          ) {
            try {
              entry.module = moduleSummary(
                file.path,
                source.read(file.rootId, file.path)!,
              );
            } catch (error) {
              entry.state = "invalid";
              result.missingEvidence.push(`${file.path}: ${String(error)}`);
            }
          }
          return entry;
        });
      if (section === "models")
        result.metadata.sharedModelPackages = (
          workspace?.sharedPackages ?? []
        ).filter((item) => item.kind === "models");
      if (section === "frontend")
        result.metadata.configuration =
          getInspectionConfig(project)?.field("frontend");
      if (section === "docs")
        result.metadata.openapi =
          getInspectionConfig(project)?.field("openapi");
    }
  } catch (error) {
    result.missingEvidence.push(String(error));
  }
  result.items.sort((a, b) => String(a.key).localeCompare(String(b.key), "en"));
  result.missingEvidence = [...new Set(result.missingEvidence)];
  result.state = result.missingEvidence.length
    ? "partial"
    : result.items.length
      ? "complete"
      : "absent";
  return result;
}

function relativeSource(
  project: VextMcpProjectInspection,
  file: string,
): string {
  return path.isAbsolute(file)
    ? path.relative(project.identity.rootDir, file).split(path.sep).join("/")
    : file;
}

function moduleSummary(file: string, text: string) {
  const module = createStaticModuleFromText(file, text);
  const exports: string[] = [];
  let defaultExport: unknown = { state: "absent" };
  for (const statement of module.program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      exports.push("default");
      const node = unwrapStaticExpression(statement.declaration);
      defaultExport = {
        kind: node.type,
        ...staticFact(
          readStaticExpression(node, module.bindings, module.invalid),
          [file],
        ),
      };
    }
    if (statement.type === "ExportNamedDeclaration") {
      for (const specifier of statement.specifiers)
        exports.push(
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : String(specifier.exported.value),
        );
      const declaration = statement.declaration;
      if (declaration?.type === "VariableDeclaration") {
        for (const item of declaration.declarations)
          if (item.id.type === "Identifier") exports.push(item.id.name);
      } else if (
        declaration &&
        "id" in declaration &&
        declaration.id?.type === "Identifier"
      )
        exports.push(declaration.id.name);
    }
  }
  return { exports: [...new Set(exports)].sort(), defaultExport };
}
