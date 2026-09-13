import type {
  VextGenerateChangesInput,
  VextValidateChangesInput,
} from "./contracts.js";
import type { VextMcpProjectInspection } from "./project-inspector.js";

export interface VextMcpChangeSetFile {
  path: string;
  action: "create";
  encoding: "utf8";
  content: string;
  reason: string;
}

export interface VextMcpChangeSet {
  schemaVersion: 1;
  kind: "change-set";
  recipeId: string;
  recipeTitle: string;
  name: string;
  baseIdentity: {
    projectId: string;
    contextRevision: string | null;
  };
  files: VextMcpChangeSetFile[];
  warnings: string[];
  requiredHostSteps: string[];
}

export interface VextMcpChangeSetResult {
  status: "ready" | "unsupported" | "invalid";
  changeSet?: VextMcpChangeSet;
  diagnostics: string[];
  missingEvidence: string[];
}

const SUPPORTED_RECIPES = new Map([
  ["RCP-01", "api-route"],
  ["api-route", "api-route"],
  ["RCP-02", "api-module"],
  ["api-module", "api-module"],
  ["RCP-03", "page-route"],
  ["page-route", "page-route"],
  ["RCP-04", "page-and-api"],
  ["page-and-api", "page-and-api"],
  ["RCP-05", "service"],
  ["service", "service"],
  ["RCP-06", "model"],
  ["model", "model"],
  ["RCP-07", "middleware"],
  ["middleware", "middleware"],
  ["RCP-08", "plugin"],
  ["plugin", "plugin"],
  ["RCP-09", "locale"],
  ["locale", "locale"],
  ["RCP-10", "test"],
  ["test", "test"],
  ["RCP-11", "type-contract"],
  ["type-contract", "type-contract"],
  ["RCP-12", "utility"],
  ["utility", "utility"],
  ["RCP-13", "frontend-component"],
  ["frontend-component", "frontend-component"],
  ["RCP-14", "frontend-layout"],
  ["frontend-layout", "frontend-layout"],
  ["RCP-15", "reusable-schema"],
  ["reusable-schema", "reusable-schema"],
  ["RCP-16", "mock-scenario"],
  ["mock-scenario", "mock-scenario"],
  ["RCP-17", "job-handler"],
  ["job-handler", "job-handler"],
]);

const SAFE_SEGMENT_PATTERN = /^[a-z][a-z0-9-]{0,119}$/;

export function generateMcpChangeSet(
  input: VextGenerateChangesInput,
  project: VextMcpProjectInspection,
): VextMcpChangeSetResult {
  const recipe = SUPPORTED_RECIPES.get(input.recipeId);
  if (!recipe) {
    return {
      status: "unsupported",
      diagnostics: [
        `Recipe ${input.recipeId} is registered but its generator is not implemented in this batch.`,
      ],
      missingEvidence: [
        "A generator implementation for this recipe is not available yet.",
      ],
    };
  }
  const normalizedName = toKebabName(input.name);
  if (!normalizedName) {
    return {
      status: "invalid",
      diagnostics: [
        "name must be a kebab-case identifier after normalization.",
      ],
      missingEvidence: [],
    };
  }
  const files = filesForRecipe(recipe, normalizedName, input, project);
  const changeSet: VextMcpChangeSet = {
    schemaVersion: 1,
    kind: "change-set",
    recipeId: input.recipeId,
    recipeTitle: recipe,
    name: normalizedName,
    baseIdentity: {
      projectId: project.identity.projectId,
      contextRevision: project.identity.contextRevision,
    },
    files,
    warnings: project.identity.contextRevision
      ? []
      : [
          "Project contextRevision is unavailable; inspect a complete project before applying.",
        ],
    requiredHostSteps: [
      "Review every file in the ChangeSet before applying it.",
      "Apply the candidate files in the host workspace only after checking for existing files.",
      "Run typecheck, focused tests, and any affected docs checks after applying.",
    ],
  };
  const validation = validateMcpChangeSet(changeSet);
  if (!validation.ok) {
    return {
      status: "invalid",
      diagnostics: validation.diagnostics,
      missingEvidence: [],
    };
  }
  return { status: "ready", changeSet, diagnostics: [], missingEvidence: [] };
}

export function validateMcpChangeSetInput(input: VextValidateChangesInput): {
  verdict: "valid" | "invalid" | "incomplete";
  diagnostics: string[];
  fileCount: number;
} {
  if (input.changeSet) {
    const validation = validateMcpChangeSet(input.changeSet);
    return {
      verdict: validation.ok ? "valid" : "invalid",
      diagnostics: validation.diagnostics,
      fileCount: validation.fileCount,
    };
  }
  if (input.files) {
    const validation = validateCandidateFiles(input.files);
    return {
      verdict: validation.ok ? "valid" : "invalid",
      diagnostics: validation.diagnostics,
      fileCount: validation.fileCount,
    };
  }
  return {
    verdict: "incomplete",
    diagnostics: ["changeSet or files is required."],
    fileCount: 0,
  };
}

function filesForRecipe(
  recipe: string,
  name: string,
  input: VextGenerateChangesInput,
  project: VextMcpProjectInspection,
): VextMcpChangeSetFile[] {
  if (recipe === "type-contract") return [typeContractFile(name, input)];
  if (recipe === "api-route") return [apiRouteFile(name)];
  if (recipe === "api-module") return [apiRouteFile(name), serviceFile(name)];
  if (recipe === "page-route") return pageRouteFiles(name);
  if (recipe === "page-and-api")
    return [...pageRouteFiles(name), apiRouteFile(`${name}-api`)];
  if (recipe === "service") return [serviceFile(name)];
  if (recipe === "model") return [modelFile(name)];
  if (recipe === "middleware") return [middlewareFile(name)];
  if (recipe === "plugin") return [pluginFile(name)];
  if (recipe === "locale") return localeFiles(name, input);
  if (recipe === "test") return [testFile(name)];
  if (recipe === "frontend-component") return [frontendComponentFile(name)];
  if (recipe === "frontend-layout") return [frontendLayoutFile(name)];
  if (recipe === "reusable-schema") return [reusableSchemaFile(name)];
  if (recipe === "mock-scenario") return [mockScenarioFile(name)];
  if (recipe === "utility") return [utilityFile(name)];
  return [jobHandlerFile(name, input, project)];
}

function apiRouteFile(name: string): VextMcpChangeSetFile {
  const routePath = `/${name}`;
  return {
    path: `src/routes/${name}.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create a conventional Vext API route file.",
    content: `import { defineRoutes } from "vextjs";\n\nexport default defineRoutes((app) => {\n  app.get(\n    "/",\n    {\n      docs: { summary: "Read ${escapeString(routePath)}" },\n    },\n    (_req, res) => {\n      res.json({ ok: true, resource: "${escapeString(name)}" });\n    },\n  );\n});\n`,
  };
}

function serviceFile(name: string): VextMcpChangeSetFile {
  const className = `${toPascalName(name)}Service`;
  return {
    path: `src/services/${name}.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create a service owned by the application service loader.",
    content: `export default class ${className} {\n  async health() {\n    return { ok: true };\n  }\n}\n`,
  };
}

function pageRouteFiles(name: string): VextMcpChangeSetFile[] {
  const pageName = name;
  return [
    {
      path: `src/routes/${name}.ts`,
      action: "create",
      encoding: "utf8",
      reason: "Create a route that renders a Vext frontend page.",
      content: `import { defineRoutes } from "vextjs";\n\nexport default defineRoutes((app) => {\n  app.get(\n    "/",\n    {\n      docs: { summary: "Render ${escapeString(pageName)} page" },\n    },\n    (_req, res) => {\n      res.render("${escapeString(pageName)}", { title: "${escapeString(toPascalName(name))}" });\n    },\n  );\n});\n`,
    },
    {
      path: `src/frontend/pages/${name}.tsx`,
      action: "create",
      encoding: "utf8",
      reason: "Create the frontend page consumed by res.render().",
      content: `export default function ${toPascalName(name)}Page(props: { title?: string }) {\n  return <main>{props.title ?? "${escapeString(toPascalName(name))}"}</main>;\n}\n`,
    },
  ];
}

function modelFile(name: string): VextMcpChangeSetFile {
  return {
    path: `src/models/${name}.ts`,
    action: "create",
    encoding: "utf8",
    reason:
      "Create a side-effect-free model definition skeleton for explicit review.",
    content: `export default {\n  name: "${escapeString(toCamelName(name))}",\n  collection: "${escapeString(name)}",\n  schema: {\n    id: \"string\",\n  },\n};\n`,
  };
}

function middlewareFile(name: string): VextMcpChangeSetFile {
  return {
    path: `src/middlewares/${name}.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create a tagged Vext middleware skeleton.",
    content: `import { defineMiddleware } from "vextjs";\n\nexport default defineMiddleware(async (_req, _res, next) => {\n  await next();\n});\n`,
  };
}

function pluginFile(name: string): VextMcpChangeSetFile {
  return {
    path: `src/plugins/${name}.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create a Vext plugin lifecycle skeleton.",
    content: `import { definePlugin } from "vextjs";\n\nexport default definePlugin({\n  name: "${escapeString(name)}",\n  setup(app) {\n    app.logger.debug("${escapeString(name)} plugin initialized");\n  },\n});\n`,
  };
}

function localeFiles(
  name: string,
  input: VextGenerateChangesInput,
): VextMcpChangeSetFile[] {
  const locale = readStringOption(input.options, "locale") ?? "en-US";
  const messageKey = `${name}.example`;
  return [
    {
      path: `src/locales/${name}/${locale}.json`,
      action: "create",
      encoding: "utf8",
      reason: "Create a feature-scoped locale JSON file.",
      content: `${JSON.stringify({ [messageKey]: { code: 40000, message: "Example message" } }, null, 2)}\n`,
    },
  ];
}

function testFile(name: string): VextMcpChangeSetFile {
  return {
    path: `test/unit/${name}.test.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create a focused Vitest unit test skeleton.",
    content: `import { describe, expect, it } from "vitest";\n\ndescribe("${escapeString(name)}", () => {\n  it("defines the expected behavior", () => {\n    expect(true).toBe(true);\n  });\n});\n`,
  };
}

function frontendComponentFile(name: string): VextMcpChangeSetFile {
  return {
    path: `src/frontend/components/${toPascalName(name)}.tsx`,
    action: "create",
    encoding: "utf8",
    reason: "Create a browser-safe frontend component skeleton.",
    content: `export interface ${toPascalName(name)}Props {\n  title?: string;\n}\n\nexport function ${toPascalName(name)}(props: ${toPascalName(name)}Props) {\n  return <section>{props.title ?? "${escapeString(toPascalName(name))}"}</section>;\n}\n`,
  };
}

function frontendLayoutFile(name: string): VextMcpChangeSetFile {
  const componentName = `${toPascalName(name)}Layout`;
  return {
    path: `src/frontend/pages/${name}/layout.tsx`,
    action: "create",
    encoding: "utf8",
    reason: "Create a page-local frontend layout skeleton.",
    content: `export default function ${componentName}() {\n  return <div data-layout="${escapeString(name)}" />;\n}\n`,
  };
}

function reusableSchemaFile(name: string): VextMcpChangeSetFile {
  return {
    path: `src/schemas/${name}.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create a reusable schema-dsl contract for explicit imports.",
    content: `import { schemaAdapter } from "vextjs";\n\nexport const ${toCamelName(name)}Schema = {\n  id: schemaAdapter.compileField("string:1-120!").description("Stable identifier"),\n};\n`,
  };
}

function mockScenarioFile(name: string): VextMcpChangeSetFile {
  return {
    path: `src/mocks/${name}.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create an application-owned mock scenario module.",
    content: `export const ${toCamelName(name)}Mock = {\n  id: "${escapeString(name)}",\n  status: "ready",\n};\n`,
  };
}

function typeContractFile(
  name: string,
  input: VextGenerateChangesInput,
): VextMcpChangeSetFile {
  const interfaceName = `${toPascalName(name)}Contract`;
  const description =
    readStringOption(input.options, "description") ??
    "Shared serializable contract.";
  return {
    path: `src/types/shared/${name}.d.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create an application-owned shared type contract.",
    content: `/** ${escapeComment(description)} */\nexport interface ${interfaceName} {\n  /** Stable identifier supplied by the application. */\n  id: string;\n}\n`,
  };
}

function utilityFile(name: string): VextMcpChangeSetFile {
  const functionName = toCamelName(name);
  return {
    path: `src/utils/${name}.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create a small owner-near utility module.",
    content: `export function ${functionName}<T>(value: T): T {\n  return value;\n}\n`,
  };
}

function jobHandlerFile(
  name: string,
  input: VextGenerateChangesInput,
  project: VextMcpProjectInspection,
): VextMcpChangeSetFile {
  const jobName = readStringOption(input.options, "jobName") ?? name;
  const queue = readStringOption(input.options, "queue") ?? "default";
  const jobsRoot = project.snapshot.sections.jobs?.actualPath ?? "src/jobs";
  return {
    path: `${jobsRoot}/${name}.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create a Vext Job handler skeleton for host-side review.",
    content: `import { defineJob } from "vextjs";\n\nexport default defineJob({\n  name: "${escapeString(jobName)}",\n  queue: "${escapeString(queue)}",\n  async handler(ctx) {\n    ctx.logger?.info({ job: "${escapeString(jobName)}" }, "job started");\n  },\n});\n`,
  };
}

function validateMcpChangeSet(value: unknown): {
  ok: boolean;
  diagnostics: string[];
  fileCount: number;
} {
  if (!isRecord(value)) return invalidCandidate("changeSet must be an object.");
  if (value.schemaVersion !== 1)
    return invalidCandidate("changeSet.schemaVersion must be 1.");
  if (value.kind !== "change-set")
    return invalidCandidate("changeSet.kind must be change-set.");
  if (!Array.isArray(value.files))
    return invalidCandidate("changeSet.files must be an array.");
  return validateCandidateFiles(value.files);
}

function validateCandidateFiles(files: unknown[]): {
  ok: boolean;
  diagnostics: string[];
  fileCount: number;
} {
  if (files.length < 1 || files.length > 50) {
    return invalidCandidate(
      "files must contain 1 to 50 entries.",
      files.length,
    );
  }
  const seen = new Set<string>();
  const diagnostics: string[] = [];
  for (const file of files) {
    if (!isRecord(file)) {
      diagnostics.push("file entry must be an object.");
      continue;
    }
    if (file.action !== undefined && file.action !== "create") {
      diagnostics.push("Only create actions are supported in this batch.");
    }
    if (typeof file.path !== "string" || !isSafeRelativePath(file.path)) {
      diagnostics.push("file.path must be a safe relative path.");
      continue;
    }
    if (seen.has(file.path))
      diagnostics.push(`Duplicate file path ${file.path}.`);
    seen.add(file.path);
    if (typeof file.content !== "string")
      diagnostics.push(`${file.path} content must be a string.`);
    if (file.encoding !== undefined && file.encoding !== "utf8")
      diagnostics.push(`${file.path} encoding must be utf8.`);
  }
  return { ok: diagnostics.length === 0, diagnostics, fileCount: files.length };
}

function invalidCandidate(message: string, fileCount = 0) {
  return { ok: false, diagnostics: [message], fileCount };
}

function toKebabName(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[ _]+/g, "-")
    .toLowerCase();
  return SAFE_SEGMENT_PATTERN.test(normalized) ? normalized : null;
}

function toPascalName(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toCamelName(value: string): string {
  const pascal = toPascalName(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function readStringOption(
  options: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = options?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized.length > 0 &&
    normalized.length <= 260 &&
    !/^(?:[A-Za-z]:|\/)/.test(normalized) &&
    !/(^|\/)\.\.(?:\/|$)/.test(normalized) &&
    !normalized.includes("\0")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapeString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeComment(value: string): string {
  return value.replaceAll("*/", "*\\/");
}
