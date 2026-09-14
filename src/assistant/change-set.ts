import { existsSync } from "node:fs";
import path from "node:path";
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

export interface VextMcpValidationFileResult {
  path: string | null;
  verdict: "valid" | "invalid";
  directory?: VextMcpCandidateDirectory;
  issues: string[];
}

export interface VextMcpCandidateDirectory {
  prefix: string;
  source:
    | "default"
    | "project-section"
    | "workspace-service"
    | "workspace-shared-package";
  role?: string;
  serviceId?: string;
  packageId?: string;
  packageKind?: string;
}

export interface VextMcpValidationResult {
  verdict: "valid" | "invalid" | "incomplete";
  diagnostics: string[];
  fileCount: number;
  files: VextMcpValidationFileResult[];
  allowedDirectories: VextMcpCandidateDirectory[];
  requiredHostSteps: string[];
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
const DEFAULT_CANDIDATE_SECTION_ROLES = [
  "routes",
  "services",
  "models",
  "schemas",
  "middlewares",
  "plugins",
  "locales",
  "shared-types",
  "server-types",
  "frontend-types",
  "utils",
  "mocks",
  "jobs",
  "frontend-pages",
  "frontend-components",
  "frontend-locales",
  "frontend-styles",
  "frontend-assets",
  "tests",
] as const;

const DEFAULT_SERVICE_CANDIDATE_PATHS = [
  "src/routes",
  "src/services",
  "src/models",
  "src/schemas",
  "src/middlewares",
  "src/plugins",
  "src/locales",
  "src/types/shared",
  "src/types/server",
  "src/types/frontend",
  "src/utils",
  "src/mocks",
  "src/jobs",
  "src/frontend/pages",
  "src/frontend/components",
  "src/frontend/locales",
  "src/frontend/styles",
  "src/frontend/assets",
  "test/unit",
] as const;

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

export function validateMcpChangeSetInput(
  input: VextValidateChangesInput,
  project?: VextMcpProjectInspection,
): VextMcpValidationResult {
  if (input.changeSet) {
    const validation = validateMcpChangeSet(input.changeSet, project);
    return {
      verdict: validation.ok ? "valid" : "invalid",
      diagnostics: validation.diagnostics,
      fileCount: validation.fileCount,
      files: validation.files,
      allowedDirectories: validation.allowedDirectories,
      requiredHostSteps: validation.requiredHostSteps,
    };
  }
  if (input.files) {
    const validation = validateCandidateFiles(input.files, project);
    return {
      verdict: validation.ok ? "valid" : "invalid",
      diagnostics: validation.diagnostics,
      fileCount: validation.fileCount,
      files: validation.files,
      allowedDirectories: validation.allowedDirectories,
      requiredHostSteps: validation.requiredHostSteps,
    };
  }
  return {
    verdict: "incomplete",
    diagnostics: ["changeSet or files is required."],
    fileCount: 0,
    files: [],
    allowedDirectories: candidateDirectoryPolicy(project),
    requiredHostSteps: ["Provide candidate files before planning validation."],
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
  if (recipe === "api-module")
    return [apiRouteFile(name), ...serviceFiles(name)];
  if (recipe === "page-route") return pageRouteFiles(name);
  if (recipe === "page-and-api")
    return [...pageRouteFiles(name), apiRouteFile(`${name}-api`)];
  if (recipe === "service") return serviceFiles(name);
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
    content: `import { defineRoutes } from "vextjs";\n\nexport default defineRoutes((app) => {\n  app.get(\n    "/",\n    {\n      responses: {\n        200: { schema: { ok: "boolean!", resource: "string!" } },\n      },\n      docs: { summary: "Read ${escapeString(routePath)}" },\n    },\n    (_req, res) => {\n      res.json({ ok: true, resource: "${escapeString(name)}" });\n    },\n  );\n});\n`,
  };
}

function serviceFiles(name: string): VextMcpChangeSetFile[] {
  const className = `${toPascalName(name)}Service`;
  const healthType = `${className}Health`;
  return [
    {
      path: `src/types/server/services/${name}.ts`,
      action: "create",
      encoding: "utf8",
      reason: "Create a type-only service contract owned by the application.",
      content: `export interface ${healthType} {\n  ok: boolean;\n  checkedAt: string;\n}\n`,
    },
    {
      path: `src/services/${name}.ts`,
      action: "create",
      encoding: "utf8",
      reason:
        "Create a concise service owned by the application service loader.",
      content: `import type { ${healthType} } from "../types/server/services/${name}.js";\n\nexport default class ${className} {\n  async health(): Promise<${healthType}> {\n    return { ok: true, checkedAt: new Date().toISOString() };\n  }\n}\n`,
    },
  ];
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
  const documentName = `${toPascalName(name)}Document`;
  const modelName = `${toPascalName(name)}Model`;
  return {
    path: `src/models/${name}.ts`,
    action: "create",
    encoding: "utf8",
    reason:
      "Create a side-effect-free model definition skeleton for explicit review.",
    content: `import type { VextModelDefinition } from "vextjs";\n\nexport interface ${documentName} {\n  id: string;\n  createdAt: string;\n  updatedAt?: string;\n}\n\nconst ${modelName} = {\n  collection: "${escapeString(name)}",\n  schema: {\n    id: "string:1-!",\n    createdAt: "datetime!",\n    updatedAt: "datetime?",\n  },\n} satisfies VextModelDefinition<${documentName}>;\n\nexport default ${modelName};\n`,
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
  const target = readStringOption(input.options, "target") ?? "frontend";
  const feature =
    toSafeModulePath(readStringOption(input.options, "module") ?? name) ?? name;
  const messageKey = `${name}.example`;
  const isBackend = target === "backend" || target === "server";
  return [
    {
      path: isBackend
        ? `src/locales/${feature}/${locale}.json`
        : `src/frontend/locales/${feature}/${locale}.json`,
      action: "create",
      encoding: "utf8",
      reason: isBackend
        ? "Create a backend feature-scoped locale JSON file."
        : "Create a frontend feature-scoped locale JSON file.",
      content: `${JSON.stringify({ [messageKey]: { code: 40000, message: "Example message" } }, null, 2)}\n`,
    },
  ];
}

function testFile(name: string): VextMcpChangeSetFile {
  const contractName = toCamelName(name);
  return {
    path: `test/unit/${name}.test.ts`,
    action: "create",
    encoding: "utf8",
    reason: "Create a focused Vitest unit test skeleton.",
    content: `import { describe, expect, it } from "vitest";\n\nconst ${contractName}Contract = {\n  feature: "${escapeString(name)}",\n  successStatus: 200,\n} as const;\n\ndescribe("${escapeString(name)}", () => {\n  it("defines the public behavior contract", () => {\n    expect(${contractName}Contract).toMatchObject({\n      feature: "${escapeString(name)}",\n      successStatus: 200,\n    });\n  });\n});\n`,
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

function validateMcpChangeSet(
  value: unknown,
  project?: VextMcpProjectInspection,
): {
  ok: boolean;
  diagnostics: string[];
  fileCount: number;
  files: VextMcpValidationFileResult[];
  allowedDirectories: VextMcpCandidateDirectory[];
  requiredHostSteps: string[];
} {
  if (!isRecord(value)) return invalidCandidate("changeSet must be an object.");
  if (value.schemaVersion !== 1)
    return invalidCandidate("changeSet.schemaVersion must be 1.");
  if (value.kind !== "change-set")
    return invalidCandidate("changeSet.kind must be change-set.");
  if (!Array.isArray(value.files))
    return invalidCandidate("changeSet.files must be an array.");
  const validation = validateCandidateFiles(value.files, project);
  const diagnostics = [...validation.diagnostics];
  if (project && isRecord(value.baseIdentity)) {
    if (value.baseIdentity.projectId !== project.identity.projectId) {
      diagnostics.push(
        "changeSet.baseIdentity.projectId does not match the current project.",
      );
    }
    if (
      value.baseIdentity.contextRevision !== project.identity.contextRevision
    ) {
      diagnostics.push(
        "changeSet.baseIdentity.contextRevision does not match the current project.",
      );
    }
  }
  return {
    ok: validation.ok && diagnostics.length === 0,
    diagnostics,
    fileCount: validation.fileCount,
    files: validation.files,
    allowedDirectories: validation.allowedDirectories,
    requiredHostSteps: validation.requiredHostSteps,
  };
}

function validateCandidateFiles(
  files: unknown[],
  project?: VextMcpProjectInspection,
): {
  ok: boolean;
  diagnostics: string[];
  fileCount: number;
  files: VextMcpValidationFileResult[];
  allowedDirectories: VextMcpCandidateDirectory[];
  requiredHostSteps: string[];
} {
  const allowedDirectories = candidateDirectoryPolicy(project);
  if (files.length < 1 || files.length > 50) {
    return invalidCandidate(
      "files must contain 1 to 50 entries.",
      files.length,
      allowedDirectories,
    );
  }
  const seen = new Set<string>();
  const diagnostics: string[] = [];
  const fileResults: VextMcpValidationFileResult[] = [];
  for (const file of files) {
    const fileIssues: string[] = [];
    if (!isRecord(file)) {
      const issue = "file entry must be an object.";
      diagnostics.push(issue);
      fileResults.push({ path: null, verdict: "invalid", issues: [issue] });
      continue;
    }
    if (file.action !== undefined && file.action !== "create") {
      fileIssues.push("Only create actions are supported in this batch.");
    }
    if (typeof file.path !== "string" || !isSafeRelativePath(file.path)) {
      fileIssues.push("file.path must be a safe relative path.");
      diagnostics.push(...fileIssues);
      fileResults.push({
        path: typeof file.path === "string" ? file.path : null,
        verdict: "invalid",
        issues: fileIssues,
      });
      continue;
    }
    const directory = findCandidateDirectory(file.path, allowedDirectories);
    if (!directory) {
      fileIssues.push(
        `${file.path} is outside supported Vext candidate directories.`,
      );
    }
    if (project && existsSync(path.join(project.identity.rootDir, file.path))) {
      fileIssues.push(
        `${file.path} already exists; create-only candidates must not overwrite files.`,
      );
    }
    if (seen.has(file.path))
      fileIssues.push(`Duplicate file path ${file.path}.`);
    seen.add(file.path);
    if (typeof file.content !== "string")
      fileIssues.push(`${file.path} content must be a string.`);
    if (typeof file.content === "string") {
      fileIssues.push(...contentQualityIssues(file.path, file.content));
    }
    if (file.encoding !== undefined && file.encoding !== "utf8")
      fileIssues.push(`${file.path} encoding must be utf8.`);
    diagnostics.push(...fileIssues);
    fileResults.push({
      path: file.path,
      verdict: fileIssues.length === 0 ? "valid" : "invalid",
      directory,
      issues: fileIssues,
    });
  }
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    fileCount: files.length,
    files: fileResults,
    allowedDirectories,
    requiredHostSteps: planHostValidationSteps(fileResults),
  };
}

function invalidCandidate(
  message: string,
  fileCount = 0,
  allowedDirectories: VextMcpCandidateDirectory[] = [],
) {
  return {
    ok: false,
    diagnostics: [message],
    fileCount,
    files: [],
    allowedDirectories,
    requiredHostSteps: ["Fix candidate shape before planning validation."],
  };
}

function planHostValidationSteps(
  files: VextMcpValidationFileResult[],
): string[] {
  const steps = new Set<string>([
    "Review every candidate file before applying it.",
    "Run npm run typecheck after applying candidate files.",
  ]);
  for (const file of files) {
    if (!file.path || file.verdict !== "valid") {
      steps.add("Fix candidate diagnostics before applying any file.");
      continue;
    }
    const normalized = file.path.replaceAll("\\", "/");
    const role = file.directory?.role;
    if (
      role === "routes" ||
      role === "services" ||
      role === "models" ||
      role === "middlewares" ||
      role === "plugins" ||
      role === "schemas" ||
      role === "shared-types" ||
      role === "server-types" ||
      role === "frontend-types" ||
      role === "utils" ||
      normalized.includes("/src/routes/") ||
      normalized.includes("/src/services/") ||
      normalized.includes("/src/models/") ||
      normalized.includes("/src/schemas/")
    ) {
      steps.add(
        "Run focused backend unit or integration tests for affected routes/services/models.",
      );
    }
    if (
      role === "frontend-pages" ||
      role === "frontend-components" ||
      role === "frontend-styles" ||
      role === "frontend-assets" ||
      normalized.includes("/src/frontend/")
    ) {
      steps.add(
        "Run npm run build and affected frontend/e2e checks after applying frontend files.",
      );
    }
    if (
      role === "locales" ||
      role === "frontend-locales" ||
      normalized.includes("/src/locales/") ||
      normalized.includes("/src/frontend/locales/")
    ) {
      steps.add("Run affected locale/i18n tests after applying locale files.");
    }
    if (role === "jobs" || normalized.includes("/src/jobs/")) {
      steps.add(
        "Run focused job unit tests and scheduler/worker integration checks for affected jobs.",
      );
    }
    if (role === "tests" || normalized.startsWith("test/")) {
      steps.add("Run the new or changed focused test file directly.");
    }
    if (file.directory?.source === "workspace-shared-package") {
      steps.add(
        "Run tests for every workspace service that consumes the changed shared package.",
      );
    }
  }
  return [...steps];
}

function contentQualityIssues(filePath: string, content: string): string[] {
  const normalized = filePath.replaceAll("\\", "/");
  const issues: string[] = [];
  if (content.length > 240 && content.split(/\r?\n/u).length < 4) {
    issues.push(
      `${filePath} should be formatted across multiple lines before applying.`,
    );
  }
  if (normalized.startsWith("src/routes/")) {
    if (/\bdocs\s*:\s*\{[\s\S]{0,3000}?\btags\s*:/u.test(content)) {
      issues.push(
        `${filePath} uses deprecated docs.tags; tags are inferred automatically.`,
      );
    }
    if (
      /\b(?:res|reply)\.json\s*\(/u.test(content) &&
      /\bapp\.(?:get|post|put|patch|delete|head|options)\s*\(/u.test(content) &&
      !/\bresponses\s*:/u.test(content)
    ) {
      issues.push(
        `${filePath} returns JSON without top-level RouteOptions.responses.`,
      );
    }
  }
  if (
    normalized.startsWith("src/services/") &&
    (/\b(?:type|interface)\s+(?:Cursor|Collection|Db)\b/u.test(content) ||
      /\bapp\.db\b[\s\S]{0,160}\bas\s+(?:unknown\s+as\s+)?\w/u.test(content))
  ) {
    issues.push(
      `${filePath} should not define driver-like database helper types or cast app.db inside the service.`,
    );
  }
  if (
    normalized.startsWith("test/") &&
    /\bexpect\s*\(\s*(?:true|1)\s*\)\s*\.toBe\s*\(\s*(?:true|1)\s*\)/u.test(
      content,
    )
  ) {
    issues.push(`${filePath} contains a placeholder assertion.`);
  }
  return issues;
}

function toKebabName(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[ _]+/g, "-")
    .toLowerCase();
  return SAFE_SEGMENT_PATTERN.test(normalized) ? normalized : null;
}

function toSafeModulePath(value: string): string | null {
  const parts = value
    .trim()
    .split(/[\\/]+/u)
    .map((part) => toKebabName(part));
  if (parts.length < 1 || parts.length > 4 || parts.some((part) => !part)) {
    return null;
  }
  return parts.join("/");
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

function candidateDirectoryPolicy(
  project: VextMcpProjectInspection | undefined,
): VextMcpCandidateDirectory[] {
  if (!project) {
    return DEFAULT_SERVICE_CANDIDATE_PATHS.map((item) => ({
      prefix: normalizeCandidatePrefix(item),
      source: "default" as const,
    })).filter((item) => item.prefix);
  }
  const directories = new Map<string, VextMcpCandidateDirectory>();
  for (const role of DEFAULT_CANDIDATE_SECTION_ROLES) {
    const section = project.snapshot.sections[role];
    if (!section) continue;
    addCandidateDirectory(
      directories,
      section.actualPath ?? section.defaultPath,
      {
        source: "project-section",
        role,
      },
    );
  }
  for (const service of project.assistant.workspace?.config.services ?? []) {
    for (const candidatePath of DEFAULT_SERVICE_CANDIDATE_PATHS) {
      addCandidateDirectory(
        directories,
        path.posix.join(service.root, candidatePath),
        {
          source: "workspace-service",
          serviceId: service.id,
        },
      );
    }
  }
  for (const sharedPackage of project.assistant.workspace?.config
    .sharedPackages ?? []) {
    addCandidateDirectory(directories, sharedPackage.root, {
      source: "workspace-shared-package",
      packageId: sharedPackage.id,
      packageKind: sharedPackage.kind,
    });
    for (const exportedPath of Object.values(sharedPackage.sourceExports)) {
      addCandidateDirectory(
        directories,
        path.posix.join(sharedPackage.root, path.posix.dirname(exportedPath)),
        {
          source: "workspace-shared-package",
          packageId: sharedPackage.id,
          packageKind: sharedPackage.kind,
        },
      );
    }
  }
  return [...directories.values()].sort((a, b) =>
    a.prefix.localeCompare(b.prefix),
  );
}

function addCandidateDirectory(
  directories: Map<string, VextMcpCandidateDirectory>,
  value: string | null,
  metadata: Omit<VextMcpCandidateDirectory, "prefix">,
): void {
  if (!value) return;
  if (!isSafeRelativePath(value)) return;
  const prefix = normalizeCandidatePrefix(value);
  if (prefix && !directories.has(prefix)) {
    directories.set(prefix, { prefix, ...metadata });
  }
}

function normalizeCandidatePrefix(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized === "." ? "" : `${normalized}/`;
}

function findCandidateDirectory(
  value: string,
  directories: VextMcpCandidateDirectory[],
): VextMcpCandidateDirectory | undefined {
  const normalized = value.replaceAll("\\", "/");
  return directories
    .filter((directory) => normalized.startsWith(directory.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
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
