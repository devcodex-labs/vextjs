import type { ProjectDiagnosticMetadata } from "./contracts.js";

/** MCP 与 Doctor 使用同一静态判定元数据；用户风格规则由 assistant 层另行附加。 */
export const PROJECT_DIAGNOSTIC_RULES: Readonly<
  Record<string, ProjectDiagnosticMetadata>
> = {
  VEXT_MCP_REQUEST_SCHEMA_BOUNDARY_REVIEW: {
    domain: "routes",
    minimumProfile: "standard",
    evidence: "review",
  },
  VEXT_MCP_SERVICE_DEPENDENCY_INVALID: {
    domain: "services",
    minimumProfile: "standard",
    evidence: "deterministic",
  },
  VEXT_MCP_SERVICE_DEPENDENCY_ANALYSIS_INCOMPLETE: {
    domain: "services",
    minimumProfile: "standard",
    evidence: "review",
    incomplete: true,
  },
  VEXT_MCP_DEPRECATED_DOCS_TAGS: {
    domain: "routes",
    minimumProfile: "standard",
    evidence: "deterministic",
  },
  VEXT_MCP_ROUTE_RESPONSE_SCHEMA_INVALID: {
    domain: "routes",
    minimumProfile: "standard",
    evidence: "deterministic",
  },
  VEXT_MCP_ROUTE_RESPONSE_SCHEMA_MISSING: {
    domain: "routes",
    minimumProfile: "standard",
    evidence: "deterministic",
  },
  VEXT_MCP_ROUTE_ANALYSIS_UNKNOWN: {
    domain: "routes",
    minimumProfile: "standard",
    evidence: "review",
    incomplete: true,
  },
  VEXT_MCP_SOURCE_SYNTAX_ERROR: {
    domain: "structure",
    minimumProfile: "standard",
    evidence: "deterministic",
  },
  VEXT_MCP_DATABASE_CURSOR_SECRET_REVIEW: {
    domain: "models",
    minimumProfile: "quick",
    evidence: "review",
  },
  VEXT_MCP_RATE_LIMIT_REDIS_TARGET_MISSING: {
    domain: "configuration",
    minimumProfile: "quick",
    evidence: "deterministic",
  },
  VEXT_MCP_RATE_LIMIT_REDIS_ENV_REQUIRED: {
    domain: "configuration",
    minimumProfile: "quick",
    evidence: "review",
    incomplete: true,
  },
  VEXT_MCP_CONFIG_INVALID: {
    domain: "configuration",
    minimumProfile: "quick",
    evidence: "deterministic",
  },
  VEXT_MCP_CONFIG_UNKNOWN: {
    domain: "configuration",
    minimumProfile: "quick",
    evidence: "review",
    incomplete: true,
  },
};
