import { createHash } from "node:crypto";
import type { VextMcpToolName } from "./catalog.js";

export const VEXT_ASSISTANT_CONTRACT_VERSION = 1 as const;
export const VEXT_MCP_HOST_IDS = [
  "codex",
  "claude-code",
  "cursor",
  "vscode",
  "grok",
] as const;
export type VextMcpHostId = (typeof VEXT_MCP_HOST_IDS)[number];
export type VextMcpSyncMode = "auto" | "check" | "off";
export type VextAssistantLanguage = "en" | "zh";
export type VextAssistantCommentLanguage = VextAssistantLanguage | "auto";
export type VextAssistantCommentDetail = "minimal" | "necessary" | "detailed";

export interface VextAssistantFailure {
  code: string;
  message: string;
  retryable: boolean;
  action: "correct-input" | "refresh" | "restart-mcp" | "restart-dev";
}

export type VextAssistantValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; failure: VextAssistantFailure; warnings: string[] };

export interface VextDevMcpHttpConfig {
  enabled: boolean;
  port: number;
}
export interface VextDevMcpConfigInput {
  enabled?: boolean;
  hosts?: VextMcpHostId[];
  sync?: VextMcpSyncMode;
  http?: Partial<VextDevMcpHttpConfig>;
}
export interface NormalizedVextDevMcpConfig {
  schemaVersion: 1;
  declared: boolean;
  enabled: boolean;
  hosts: VextMcpHostId[];
  sync: VextMcpSyncMode;
  http: VextDevMcpHttpConfig;
}

export interface VextAssistantPolicyPatch {
  outputLanguage?: VextAssistantLanguage;
  commentLanguage?: VextAssistantCommentLanguage;
  commentDetail?: VextAssistantCommentDetail;
  roles?: Record<string, string>;
  architecture?: {
    style: "layered" | "feature" | "custom";
    featureRoot?: string;
    notes?: string;
  };
  naming?: {
    file?: "kebab-case" | "camelCase" | "PascalCase" | "preserve";
    component?: "PascalCase" | "preserve";
    service?: "camelCase" | "preserve";
  };
  scripts?: Record<string, string>;
  rules?: Array<{ id: string; level: "off" | "info" | "warning" | "error" }>;
  sourceRefs?: string[];
}
export interface NormalizedVextAssistantPolicy {
  schemaVersion: 1;
  patch: VextAssistantPolicyPatch;
  digest: string;
}

export interface VextAssistantWorkspaceConfig {
  schemaVersion: 1;
  hosts?: VextMcpHostId[];
  services?: Array<{ id: string; root: string; sharedPackages?: string[] }>;
  sharedPackages?: Array<{
    id: string;
    root: string;
    kind: "contracts" | "models" | "ui" | "config" | "utility" | "test-support";
    sourceExports: Record<string, string>;
  }>;
  policyDefaults?: VextAssistantPolicyPatch;
}

export interface VextExpectedIdentity {
  projectId: string;
  contextRevision: string;
}
export interface VextProjectInspectInput {
  section?: string;
  sourceMode?: "auto" | "baseline";
  refresh?: boolean;
  limit?: number;
  cursor?: string;
  expectedIdentity?: VextExpectedIdentity;
}
export interface VextKnowledgeSearchInput {
  query?: string;
  ids?: string[];
  kinds?: string[];
  domain?: string;
  locale?: VextAssistantLanguage;
  limit?: number;
}
export interface VextCapabilityCheckInput {
  capability: string;
}
export interface VextGenerateChangesInput {
  recipeId: string;
  name: string;
  options?: Record<string, unknown>;
  expectedIdentity?: VextExpectedIdentity;
}
export interface VextValidateChangesInput {
  profile?: "syntax" | "standard" | "strict";
  changeSet?: Record<string, unknown>;
  files?: Record<string, unknown>[];
  expectedIdentity?: VextExpectedIdentity;
}
export interface VextProjectCheckInput {
  profile?: "quick" | "standard" | "strict";
  domain?: string;
  refresh?: boolean;
  diagnosticLimit?: number;
  expectedIdentity?: VextExpectedIdentity;
}
export interface VextRuntimeInspectInput {
  section?: "summary" | "workers" | "reloads" | "events";
  limit?: number;
  cursor?: string;
  expectedIdentity?: VextExpectedIdentity;
}
export type VextMcpToolInputMap = {
  vext_project_inspect: VextProjectInspectInput;
  vext_knowledge_search: VextKnowledgeSearchInput;
  vext_capability_check: VextCapabilityCheckInput;
  vext_generate_changes: VextGenerateChangesInput;
  vext_validate_changes: VextValidateChangesInput;
  vext_project_check: VextProjectCheckInput;
  vext_runtime_inspect: VextRuntimeInspectInput;
};

const expectedIdentitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectId", "contextRevision"],
  properties: {
    projectId: { type: "string", pattern: "^[a-f0-9]{64}$" },
    contextRevision: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
};
export const PROJECT_INSPECT_SECTIONS = [
  "summary",
  "identity",
  "structure",
  "routes",
  "services",
  "serviceDependencies",
  "middlewares",
  "plugins",
  "models",
  "frontend",
  "config",
  "ownership",
  "scripts",
  "docs",
  "mocks",
  "jobs",
  "all",
] as const;
export const VEXT_MCP_TOOL_INPUT_SCHEMAS: Record<
  VextMcpToolName,
  Record<string, unknown>
> = {
  vext_project_inspect: {
    type: "object",
    additionalProperties: false,
    properties: {
      section: { type: "string", enum: PROJECT_INSPECT_SECTIONS },
      sourceMode: { type: "string", enum: ["auto", "baseline"] },
      refresh: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      cursor: { type: "string" },
      expectedIdentity: expectedIdentitySchema,
    },
  },
  vext_knowledge_search: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 1, maxLength: 500 },
      ids: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: { type: "string" },
      },
      kinds: {
        type: "array",
        items: {
          type: "string",
          enum: ["capability", "rule", "recipe", "knowledge", "workflow"],
        },
      },
      domain: { type: "string" },
      locale: { type: "string", enum: ["en", "zh"] },
      limit: { type: "integer", minimum: 1, maximum: 10 },
    },
  },
  vext_capability_check: {
    type: "object",
    additionalProperties: false,
    required: ["capability"],
    properties: { capability: { type: "string", minLength: 1 } },
  },
  vext_generate_changes: {
    type: "object",
    additionalProperties: false,
    required: ["recipeId", "name"],
    properties: {
      recipeId: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1, maxLength: 120 },
      options: { type: "object", additionalProperties: true },
      expectedIdentity: expectedIdentitySchema,
    },
  },
  vext_validate_changes: {
    type: "object",
    additionalProperties: false,
    properties: {
      profile: { type: "string", enum: ["syntax", "standard", "strict"] },
      changeSet: { type: "object", additionalProperties: true },
      files: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: { type: "object" },
      },
      expectedIdentity: expectedIdentitySchema,
    },
  },
  vext_project_check: {
    type: "object",
    additionalProperties: false,
    properties: {
      profile: { type: "string", enum: ["quick", "standard", "strict"] },
      domain: { type: "string" },
      refresh: { type: "boolean" },
      diagnosticLimit: { type: "integer", minimum: 1, maximum: 500 },
      expectedIdentity: expectedIdentitySchema,
    },
  },
  vext_runtime_inspect: {
    type: "object",
    additionalProperties: false,
    properties: {
      section: {
        type: "string",
        enum: ["summary", "workers", "reloads", "events"],
      },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cursor: { type: "string" },
      expectedIdentity: expectedIdentitySchema,
    },
  },
};
const RELATIVE_PATH_PATTERN =
  /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\0).+$/;
const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function normalizeDevMcpConfig(
  value: unknown,
  options: { declared?: boolean } = {},
): VextAssistantValidationResult<NormalizedVextDevMcpConfig> {
  const declared = options.declared ?? value !== undefined;
  const warnings: string[] = [];
  if (!declared || value === undefined)
    return ok({
      schemaVersion: 1,
      declared: false,
      enabled: false,
      hosts: [],
      sync: "off",
      http: { enabled: false, port: 3980 },
    });
  if (value === true)
    return ok({
      schemaVersion: 1,
      declared: true,
      enabled: true,
      hosts: [],
      sync: "auto",
      http: { enabled: false, port: 3980 },
    });
  if (value === false)
    return ok({
      schemaVersion: 1,
      declared: true,
      enabled: false,
      hosts: [],
      sync: "auto",
      http: { enabled: false, port: 3980 },
    });
  if (!isRecord(value)) return invalid("dev.mcp must be a boolean or object.");
  const unknownKey = firstUnknownKey(value, [
    "enabled",
    "hosts",
    "sync",
    "http",
  ]);
  if (unknownKey)
    return invalid(`dev.mcp contains unknown field ${unknownKey}.`);
  const sync =
    value.sync === undefined
      ? "auto"
      : enumValue(value.sync, ["auto", "check", "off"]);
  if (!sync) return invalid("dev.mcp.sync must be auto, check, or off.");
  const hosts = normalizeHosts(value.hosts, warnings);
  if (!hosts.ok) return hosts;
  const http = normalizeHttp(value.http);
  if (!http.ok) return http;
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      declared: true,
      enabled: typeof value.enabled === "boolean" ? value.enabled : true,
      hosts: hosts.value,
      sync,
      http: http.value,
    },
    warnings,
  };
}

export function normalizePolicyPatch(
  value: unknown,
): VextAssistantValidationResult<NormalizedVextAssistantPolicy> {
  if (value === undefined) return normalizedPolicy({});
  if (!isRecord(value)) return invalid("PolicyPatch must be an object.");
  const allowed = [
    "outputLanguage",
    "commentLanguage",
    "commentDetail",
    "roles",
    "architecture",
    "naming",
    "scripts",
    "rules",
    "sourceRefs",
  ];
  const unknownKey = firstUnknownKey(value, allowed);
  if (unknownKey)
    return invalid(`PolicyPatch contains unknown field ${unknownKey}.`);
  const patch: VextAssistantPolicyPatch = {};
  if (value.outputLanguage !== undefined) {
    const outputLanguage = enumValue(value.outputLanguage, ["en", "zh"]);
    if (!outputLanguage) return invalid("outputLanguage must be en or zh.");
    patch.outputLanguage = outputLanguage;
  }
  if (value.commentLanguage !== undefined) {
    const commentLanguage = enumValue(value.commentLanguage, [
      "en",
      "zh",
      "auto",
    ]);
    if (!commentLanguage)
      return invalid("commentLanguage must be en, zh, or auto.");
    patch.commentLanguage = commentLanguage;
  }
  if (value.commentDetail !== undefined) {
    const commentDetail = enumValue(value.commentDetail, [
      "minimal",
      "necessary",
      "detailed",
    ]);
    if (!commentDetail)
      return invalid("commentDetail must be minimal, necessary, or detailed.");
    patch.commentDetail = commentDetail;
  }
  if (value.roles !== undefined) {
    const roles = normalizeStringRecord(value.roles, "roles", isRelativePath);
    if (!roles.ok) return roles;
    patch.roles = roles.value;
  }
  if (value.scripts !== undefined) {
    const scripts = normalizeStringRecord(
      value.scripts,
      "scripts",
      (item) => item.length <= 120,
    );
    if (!scripts.ok) return scripts;
    patch.scripts = scripts.value;
  }
  if (value.sourceRefs !== undefined) {
    const refs = normalizeStringArray(
      value.sourceRefs,
      "sourceRefs",
      20,
      isRelativePath,
    );
    if (!refs.ok) return refs;
    patch.sourceRefs = refs.value;
  }
  if (value.rules !== undefined) {
    const rules = normalizeRules(value.rules);
    if (!rules.ok) return rules;
    patch.rules = rules.value;
  }
  if (value.architecture !== undefined) {
    const architecture = normalizeArchitecture(value.architecture);
    if (!architecture.ok) return architecture;
    patch.architecture = architecture.value;
  }
  if (value.naming !== undefined) {
    const naming = normalizeNaming(value.naming);
    if (!naming.ok) return naming;
    patch.naming = naming.value;
  }
  return normalizedPolicy(patch);
}

export function normalizeWorkspaceConfig(
  value: unknown,
): VextAssistantValidationResult<VextAssistantWorkspaceConfig> {
  if (!isRecord(value))
    return invalid("vext.workspace.json must be an object.");
  const unknownKey = firstUnknownKey(value, [
    "schemaVersion",
    "hosts",
    "services",
    "sharedPackages",
    "policyDefaults",
  ]);
  if (unknownKey)
    return invalid(`Workspace config contains unknown field ${unknownKey}.`);
  if (value.schemaVersion !== 1)
    return invalid("Workspace schemaVersion must be 1.");
  const warnings: string[] = [];
  const result: VextAssistantWorkspaceConfig = { schemaVersion: 1 };
  if (value.hosts !== undefined) {
    const hosts = normalizeHosts(value.hosts, warnings);
    if (!hosts.ok) return hosts;
    result.hosts = hosts.value;
  }
  if (value.services !== undefined) {
    const services = normalizeServices(value.services);
    if (!services.ok) return services;
    result.services = services.value;
  }
  if (value.sharedPackages !== undefined) {
    const sharedPackages = normalizeSharedPackages(value.sharedPackages);
    if (!sharedPackages.ok) return sharedPackages;
    result.sharedPackages = sharedPackages.value;
  }
  if (value.policyDefaults !== undefined) {
    const policy = normalizePolicyPatch(value.policyDefaults);
    if (!policy.ok) return policy;
    result.policyDefaults = policy.value.patch;
  }
  return { ok: true, value: result, warnings };
}

export function parseMcpToolInput<Name extends VextMcpToolName>(
  name: Name,
  args: unknown,
): VextAssistantValidationResult<VextMcpToolInputMap[Name]> {
  const value = args === undefined ? {} : args;
  if (!isRecord(value)) return invalid(`${name} input must be an object.`);
  switch (name) {
    case "vext_project_inspect":
      return parseProjectInspect(value) as VextAssistantValidationResult<
        VextMcpToolInputMap[Name]
      >;
    case "vext_knowledge_search":
      return parseKnowledgeSearch(value) as VextAssistantValidationResult<
        VextMcpToolInputMap[Name]
      >;
    case "vext_capability_check":
      return parseCapabilityCheck(value) as VextAssistantValidationResult<
        VextMcpToolInputMap[Name]
      >;
    case "vext_generate_changes":
      return parseGenerateChanges(value) as VextAssistantValidationResult<
        VextMcpToolInputMap[Name]
      >;
    case "vext_validate_changes":
      return parseValidateChanges(value) as VextAssistantValidationResult<
        VextMcpToolInputMap[Name]
      >;
    case "vext_project_check":
      return parseProjectCheck(value) as VextAssistantValidationResult<
        VextMcpToolInputMap[Name]
      >;
    case "vext_runtime_inspect":
      return parseRuntimeInspect(value) as VextAssistantValidationResult<
        VextMcpToolInputMap[Name]
      >;
  }
}

export function createAssistantFailure(
  code: string,
  message: string,
  action: VextAssistantFailure["action"] = "correct-input",
): VextAssistantFailure {
  return { code, message, retryable: false, action };
}
function parseProjectInspect(value: Record<string, unknown>) {
  const unknownKey = firstUnknownKey(value, [
    "section",
    "sourceMode",
    "refresh",
    "limit",
    "cursor",
    "expectedIdentity",
  ]);
  if (unknownKey)
    return invalid(
      `vext_project_inspect contains unknown field ${unknownKey}.`,
    );
  const section = optionalEnum(value.section, PROJECT_INSPECT_SECTIONS);
  if (!section.ok) return section;
  const sourceMode = optionalEnum(value.sourceMode, ["auto", "baseline"]);
  if (!sourceMode.ok) return sourceMode;
  const limit = optionalInteger(value.limit, 1, 200, "limit");
  if (!limit.ok) return limit;
  const expectedIdentity = optionalExpectedIdentity(value.expectedIdentity);
  if (!expectedIdentity.ok) return expectedIdentity;
  const refresh = optionalBoolean(value.refresh, "refresh");
  if (!refresh.ok) return refresh;
  const cursor = optionalString(value.cursor, "cursor");
  if (!cursor.ok) return cursor;
  return ok({
    section: section.value,
    sourceMode: sourceMode.value,
    refresh: refresh.value,
    limit: limit.value,
    cursor: cursor.value,
    expectedIdentity: expectedIdentity.value,
  });
}

function parseKnowledgeSearch(value: Record<string, unknown>) {
  const unknownKey = firstUnknownKey(value, [
    "query",
    "ids",
    "kinds",
    "domain",
    "locale",
    "limit",
  ]);
  if (unknownKey)
    return invalid(
      `vext_knowledge_search contains unknown field ${unknownKey}.`,
    );
  const query = optionalBoundedString(value.query, "query", 1, 500);
  if (!query.ok) return query;
  const ids = optionalStringArray(value.ids, "ids", 10);
  if (!ids.ok) return ids;
  if (query.value && ids.value)
    return invalid("query and ids are mutually exclusive.");
  if (!query.value && !ids.value) return invalid("query or ids is required.");
  const kinds = optionalEnumArray(value.kinds, "kinds", [
    "capability",
    "rule",
    "recipe",
    "knowledge",
    "workflow",
  ]);
  if (!kinds.ok) return kinds;
  const locale = optionalEnum(value.locale, ["en", "zh"]);
  if (!locale.ok) return locale;
  const limit = optionalInteger(value.limit, 1, 10, "limit");
  if (!limit.ok) return limit;
  const domain = optionalString(value.domain, "domain");
  if (!domain.ok) return domain;
  return ok({
    query: query.value,
    ids: ids.value,
    kinds: kinds.value,
    domain: domain.value,
    locale: locale.value,
    limit: limit.value,
  });
}

function parseCapabilityCheck(value: Record<string, unknown>) {
  const unknownKey = firstUnknownKey(value, ["capability"]);
  if (unknownKey)
    return invalid(
      `vext_capability_check contains unknown field ${unknownKey}.`,
    );
  const capability = optionalBoundedString(
    value.capability,
    "capability",
    1,
    120,
  );
  if (!capability.ok || !capability.value)
    return invalid("capability is required.");
  return ok({ capability: capability.value });
}

function parseGenerateChanges(value: Record<string, unknown>) {
  const unknownKey = firstUnknownKey(value, [
    "recipeId",
    "name",
    "options",
    "expectedIdentity",
  ]);
  if (unknownKey)
    return invalid(
      `vext_generate_changes contains unknown field ${unknownKey}.`,
    );
  const recipeId = optionalBoundedString(value.recipeId, "recipeId", 1, 120);
  if (!recipeId.ok || !recipeId.value) return invalid("recipeId is required.");
  const name = optionalBoundedString(value.name, "name", 1, 120);
  if (!name.ok || !name.value) return invalid("name is required.");
  if (/[\\/\0]/.test(name.value))
    return invalid("name must not contain path separators or NUL.");
  if (value.options !== undefined && !isRecord(value.options))
    return invalid("options must be an object.");
  const expectedIdentity = optionalExpectedIdentity(value.expectedIdentity);
  if (!expectedIdentity.ok) return expectedIdentity;
  return ok({
    recipeId: recipeId.value,
    name: name.value,
    options: value.options as Record<string, unknown> | undefined,
    expectedIdentity: expectedIdentity.value,
  });
}

function parseValidateChanges(value: Record<string, unknown>) {
  const unknownKey = firstUnknownKey(value, [
    "profile",
    "changeSet",
    "files",
    "expectedIdentity",
  ]);
  if (unknownKey)
    return invalid(
      `vext_validate_changes contains unknown field ${unknownKey}.`,
    );
  const profile = optionalEnum(value.profile, ["syntax", "standard", "strict"]);
  if (!profile.ok) return profile;
  const hasChangeSet = value.changeSet !== undefined;
  const hasFiles = value.files !== undefined;
  if (!hasChangeSet && !hasFiles)
    return invalid("changeSet or files is required.");
  if (hasChangeSet && hasFiles)
    return invalid("changeSet and files are mutually exclusive.");
  if (hasChangeSet && !isRecord(value.changeSet))
    return invalid("changeSet must be an object.");
  if (hasFiles && !Array.isArray(value.files))
    return invalid("files must be an array.");
  if (
    Array.isArray(value.files) &&
    (value.files.length < 1 || value.files.length > 50)
  )
    return invalid("files must contain 1 to 50 entries.");
  if (Array.isArray(value.files) && value.files.some((file) => !isRecord(file)))
    return invalid("files entries must be objects.");
  const expectedIdentity = optionalExpectedIdentity(value.expectedIdentity);
  if (!expectedIdentity.ok) return expectedIdentity;
  return ok({
    profile: profile.value,
    changeSet: value.changeSet as Record<string, unknown> | undefined,
    files: value.files as Record<string, unknown>[] | undefined,
    expectedIdentity: expectedIdentity.value,
  });
}

function parseProjectCheck(value: Record<string, unknown>) {
  const unknownKey = firstUnknownKey(value, [
    "profile",
    "domain",
    "refresh",
    "diagnosticLimit",
    "expectedIdentity",
  ]);
  if (unknownKey)
    return invalid(`vext_project_check contains unknown field ${unknownKey}.`);
  const profile = optionalEnum(value.profile, ["quick", "standard", "strict"]);
  if (!profile.ok) return profile;
  const diagnosticLimit = optionalInteger(
    value.diagnosticLimit,
    1,
    500,
    "diagnosticLimit",
  );
  if (!diagnosticLimit.ok) return diagnosticLimit;
  const expectedIdentity = optionalExpectedIdentity(value.expectedIdentity);
  if (!expectedIdentity.ok) return expectedIdentity;
  const domain = optionalString(value.domain, "domain");
  if (!domain.ok) return domain;
  const refresh = optionalBoolean(value.refresh, "refresh");
  if (!refresh.ok) return refresh;
  return ok({
    profile: profile.value,
    domain: domain.value,
    refresh: refresh.value,
    diagnosticLimit: diagnosticLimit.value,
    expectedIdentity: expectedIdentity.value,
  });
}

function parseRuntimeInspect(value: Record<string, unknown>) {
  const unknownKey = firstUnknownKey(value, [
    "section",
    "limit",
    "cursor",
    "expectedIdentity",
  ]);
  if (unknownKey)
    return invalid(
      `vext_runtime_inspect contains unknown field ${unknownKey}.`,
    );
  const section = optionalEnum(value.section, [
    "summary",
    "workers",
    "reloads",
    "events",
  ]);
  if (!section.ok) return section;
  const limit = optionalInteger(value.limit, 1, 100, "limit");
  if (!limit.ok) return limit;
  const expectedIdentity = optionalExpectedIdentity(value.expectedIdentity);
  if (!expectedIdentity.ok) return expectedIdentity;
  const cursor = optionalString(value.cursor, "cursor");
  if (!cursor.ok) return cursor;
  return ok({
    section: section.value,
    limit: limit.value,
    cursor: cursor.value,
    expectedIdentity: expectedIdentity.value,
  });
}
function normalizeHttp(
  value: unknown,
): VextAssistantValidationResult<VextDevMcpHttpConfig> {
  if (value === undefined) return ok({ enabled: false, port: 3980 });
  if (!isRecord(value)) return invalid("dev.mcp.http must be an object.");
  const unknownKey = firstUnknownKey(value, ["enabled", "port"]);
  if (unknownKey)
    return invalid(`dev.mcp.http contains unknown field ${unknownKey}.`);
  const enabled = typeof value.enabled === "boolean" ? value.enabled : false;
  const portValue = value.port === undefined ? 3980 : value.port;
  if (
    typeof portValue !== "number" ||
    !Number.isInteger(portValue) ||
    portValue < 1 ||
    portValue > 65535
  )
    return invalid("dev.mcp.http.port must be an integer between 1 and 65535.");
  return ok({ enabled, port: portValue });
}

function normalizeHosts(
  value: unknown,
  warnings: string[],
): VextAssistantValidationResult<VextMcpHostId[]> {
  if (value === undefined) return ok([]);
  if (!Array.isArray(value)) return invalid("hosts must be an array.");
  const hosts: VextMcpHostId[] = [];
  for (const item of value) {
    const host = enumValue(item, VEXT_MCP_HOST_IDS);
    if (!host) return invalid(`Unknown MCP host ${String(item)}.`);
    if (hosts.includes(host))
      warnings.push(`Duplicate MCP host ${host} was ignored.`);
    else hosts.push(host);
  }
  return ok(hosts);
}

function normalizeRules(value: unknown) {
  if (!Array.isArray(value)) return invalid("rules must be an array.");
  if (value.length > 200) return invalid("rules must not exceed 200 entries.");
  const seen = new Set<string>();
  const rules: NonNullable<VextAssistantPolicyPatch["rules"]> = [];
  for (const item of value) {
    if (!isRecord(item)) return invalid("rules entries must be objects.");
    const unknownKey = firstUnknownKey(item, ["id", "level"]);
    if (unknownKey)
      return invalid(`rules entry contains unknown field ${unknownKey}.`);
    const id = optionalBoundedString(item.id, "rule.id", 1, 120);
    if (!id.ok || !id.value) return invalid("rule.id is required.");
    if (seen.has(id.value)) return invalid(`Duplicate rule id ${id.value}.`);
    const level = enumValue(item.level, ["off", "info", "warning", "error"]);
    if (!level)
      return invalid("rule.level must be off, info, warning, or error.");
    seen.add(id.value);
    rules.push({ id: id.value, level });
  }
  return ok(rules);
}

function normalizeArchitecture(
  value: unknown,
): VextAssistantValidationResult<
  NonNullable<VextAssistantPolicyPatch["architecture"]>
> {
  if (!isRecord(value)) return invalid("architecture must be an object.");
  const unknownKey = firstUnknownKey(value, ["style", "featureRoot", "notes"]);
  if (unknownKey)
    return invalid(`architecture contains unknown field ${unknownKey}.`);
  const style = enumValue(value.style, ["layered", "feature", "custom"]);
  if (!style)
    return invalid("architecture.style must be layered, feature, or custom.");
  const featureRoot = optionalString(
    value.featureRoot,
    "architecture.featureRoot",
  );
  if (!featureRoot.ok) return featureRoot;
  if (featureRoot.value !== undefined && !isRelativePath(featureRoot.value)) {
    return invalid(
      "architecture.featureRoot must be a relative path inside the workspace.",
    );
  }
  const notes = optionalBoundedString(
    value.notes,
    "architecture.notes",
    1,
    2000,
  );
  if (!notes.ok) return notes;
  return ok({ style, featureRoot: featureRoot.value, notes: notes.value });
}

function normalizeNaming(
  value: unknown,
): VextAssistantValidationResult<
  NonNullable<VextAssistantPolicyPatch["naming"]>
> {
  if (!isRecord(value)) return invalid("naming must be an object.");
  const unknownKey = firstUnknownKey(value, ["file", "component", "service"]);
  if (unknownKey)
    return invalid(`naming contains unknown field ${unknownKey}.`);
  const file = optionalEnum(value.file, [
    "kebab-case",
    "camelCase",
    "PascalCase",
    "preserve",
  ]);
  if (!file.ok) return file;
  const component = optionalEnum(value.component, ["PascalCase", "preserve"]);
  if (!component.ok) return component;
  const service = optionalEnum(value.service, ["camelCase", "preserve"]);
  if (!service.ok) return service;
  return ok({
    file: file.value,
    component: component.value,
    service: service.value,
  });
}

function normalizeServices(value: unknown) {
  if (!Array.isArray(value)) return invalid("services must be an array.");
  if (value.length > 100)
    return invalid("services must not exceed 100 entries.");
  const seen = new Set<string>();
  const services: NonNullable<VextAssistantWorkspaceConfig["services"]> = [];
  for (const item of value) {
    if (!isRecord(item)) return invalid("services entries must be objects.");
    const unknownKey = firstUnknownKey(item, ["id", "root", "sharedPackages"]);
    if (unknownKey)
      return invalid(`service contains unknown field ${unknownKey}.`);
    const id = workspaceId(item.id, "service.id");
    if (!id.ok) return id;
    if (seen.has(id.value)) return invalid(`Duplicate service id ${id.value}.`);
    const root = workspacePath(item.root, "service.root");
    if (!root.ok) return root;
    const sharedPackages = optionalWorkspaceIdArray(
      item.sharedPackages,
      "service.sharedPackages",
      99,
    );
    if (!sharedPackages.ok) return sharedPackages;
    seen.add(id.value);
    services.push({
      id: id.value,
      root: root.value,
      sharedPackages: sharedPackages.value,
    });
  }
  return ok(services);
}

function normalizeSharedPackages(value: unknown) {
  if (!Array.isArray(value)) return invalid("sharedPackages must be an array.");
  if (value.length > 100)
    return invalid("sharedPackages must not exceed 100 entries.");
  const seen = new Set<string>();
  const packages: NonNullable<VextAssistantWorkspaceConfig["sharedPackages"]> =
    [];
  for (const item of value) {
    if (!isRecord(item))
      return invalid("sharedPackages entries must be objects.");
    const unknownKey = firstUnknownKey(item, [
      "id",
      "root",
      "kind",
      "sourceExports",
    ]);
    if (unknownKey)
      return invalid(`sharedPackage contains unknown field ${unknownKey}.`);
    const id = workspaceId(item.id, "sharedPackage.id");
    if (!id.ok) return id;
    if (seen.has(id.value))
      return invalid(`Duplicate shared package id ${id.value}.`);
    const root = workspacePath(item.root, "sharedPackage.root");
    if (!root.ok) return root;
    const kind = enumValue(item.kind, [
      "contracts",
      "models",
      "ui",
      "config",
      "utility",
      "test-support",
    ]);
    if (!kind) return invalid("sharedPackage.kind is invalid.");
    const sourceExports = normalizeStringRecord(
      item.sourceExports,
      "sourceExports",
      isRelativePath,
    );
    if (!sourceExports.ok) return sourceExports;
    seen.add(id.value);
    packages.push({
      id: id.value,
      root: root.value,
      kind,
      sourceExports: sourceExports.value,
    });
  }
  return ok(packages);
}

function normalizedPolicy(
  patch: VextAssistantPolicyPatch,
): VextAssistantValidationResult<NormalizedVextAssistantPolicy> {
  const normalized = sortDeep(patch) as VextAssistantPolicyPatch;
  return ok({
    schemaVersion: 1,
    patch: normalized,
    digest: createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex"),
  });
}
function optionalExpectedIdentity(
  value: unknown,
): VextAssistantValidationResult<VextExpectedIdentity | undefined> {
  if (value === undefined) return ok(undefined);
  if (!isRecord(value)) return invalid("expectedIdentity must be an object.");
  const unknownKey = firstUnknownKey(value, ["projectId", "contextRevision"]);
  if (unknownKey)
    return invalid(`expectedIdentity contains unknown field ${unknownKey}.`);
  if (
    typeof value.projectId !== "string" ||
    !SHA256_PATTERN.test(value.projectId)
  )
    return invalid("expectedIdentity.projectId must be a sha256 hex string.");
  if (
    typeof value.contextRevision !== "string" ||
    !SHA256_PATTERN.test(value.contextRevision)
  )
    return invalid(
      "expectedIdentity.contextRevision must be a sha256 hex string.",
    );
  return ok({
    projectId: value.projectId,
    contextRevision: value.contextRevision,
  });
}

function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): VextAssistantValidationResult<T[number] | undefined> {
  if (value === undefined) return ok(undefined);
  const parsed = enumValue(value, allowed);
  return parsed
    ? ok(parsed)
    : invalid(`Expected one of ${allowed.join(", ")}.`);
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function optionalEnumArray<const T extends readonly string[]>(
  value: unknown,
  label: string,
  allowed: T,
): VextAssistantValidationResult<T[number][] | undefined> {
  if (value === undefined) return ok(undefined);
  if (!Array.isArray(value)) return invalid(`${label} must be an array.`);
  const items: T[number][] = [];
  for (const item of value) {
    const parsed = enumValue(item, allowed);
    if (!parsed)
      return invalid(`${label} contains invalid value ${String(item)}.`);
    items.push(parsed);
  }
  return ok(items);
}

function optionalString(
  value: unknown,
  label: string,
): VextAssistantValidationResult<string | undefined> {
  if (value === undefined) return ok(undefined);
  if (typeof value !== "string") return invalid(`${label} must be a string.`);
  return ok(value);
}

function optionalBoundedString(
  value: unknown,
  label: string,
  min: number,
  max: number,
): VextAssistantValidationResult<string | undefined> {
  if (value === undefined) return ok(undefined);
  if (typeof value !== "string" || value.length < min || value.length > max)
    return invalid(
      `${label} must be a string between ${min} and ${max} characters.`,
    );
  return ok(value);
}

function optionalStringArray(
  value: unknown,
  label: string,
  maxItems: number,
): VextAssistantValidationResult<string[] | undefined> {
  return normalizeStringArray(value, label, maxItems, () => true, true);
}

function normalizeStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  predicate: (value: string) => boolean,
  optional = false,
): VextAssistantValidationResult<string[] | undefined> {
  if (value === undefined && optional) return ok(undefined);
  if (!Array.isArray(value)) return invalid(`${label} must be an array.`);
  if (value.length > maxItems)
    return invalid(`${label} must not exceed ${maxItems} entries.`);
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !predicate(item))
      return invalid(`${label} contains invalid string entry.`);
    items.push(item);
  }
  return ok(items);
}

function optionalInteger(
  value: unknown,
  min: number,
  max: number,
  label: string,
): VextAssistantValidationResult<number | undefined> {
  if (value === undefined) return ok(undefined);
  if (
    !Number.isInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  )
    return invalid(`${label} must be an integer between ${min} and ${max}.`);
  return ok(value as number);
}

function optionalBoolean(
  value: unknown,
  label: string,
): VextAssistantValidationResult<boolean | undefined> {
  if (value === undefined) return ok(undefined);
  if (typeof value !== "boolean") return invalid(`${label} must be a boolean.`);
  return ok(value);
}

function normalizeStringRecord(
  value: unknown,
  label: string,
  predicate: (value: string) => boolean,
): VextAssistantValidationResult<Record<string, string>> {
  if (!isRecord(value)) return invalid(`${label} must be an object.`);
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child !== "string" || !predicate(child))
      return invalid(`${label}.${key} is invalid.`);
    result[key] = child;
  }
  return ok(sortRecord(result));
}

function optionalWorkspaceIdArray(
  value: unknown,
  label: string,
  maxItems: number,
): VextAssistantValidationResult<string[] | undefined> {
  if (value === undefined) return ok(undefined);
  if (!Array.isArray(value)) return invalid(`${label} must be an array.`);
  if (value.length > maxItems)
    return invalid(`${label} must not exceed ${maxItems} entries.`);
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !ID_PATTERN.test(item))
      return invalid(`${label} contains invalid id.`);
    items.push(item);
  }
  return ok(items);
}

function workspaceId(
  value: unknown,
  label: string,
): VextAssistantValidationResult<string> {
  if (typeof value !== "string" || !ID_PATTERN.test(value))
    return invalid(`${label} must match ${ID_PATTERN.source}.`);
  return ok(value);
}

function workspacePath(
  value: unknown,
  label: string,
): VextAssistantValidationResult<string> {
  if (typeof value !== "string" || !isRelativePath(value))
    return invalid(`${label} must be a relative path inside the workspace.`);
  return ok(value);
}

function isRelativePath(value: string): boolean {
  return (
    value.length <= 260 &&
    RELATIVE_PATH_PATTERN.test(value.replaceAll("\\", "/"))
  );
}

function firstUnknownKey(
  value: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  return Object.keys(value).find((key) => !allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ok<T>(value: T): VextAssistantValidationResult<T> {
  return { ok: true, value, warnings: [] };
}

function invalid(message: string): VextAssistantValidationResult<never> {
  return {
    ok: false,
    failure: createAssistantFailure("VEXT_VALIDATION_FAILED", message),
    warnings: [],
  };
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortDeep(item));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortDeep(child)]),
    );
  return value;
}
