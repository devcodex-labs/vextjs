import { PROJECT_DIAGNOSTIC_RULES } from "../tooling/diagnostics/project-rules.js";
import type {
  AnalysisDomain,
  AnalysisProfile,
} from "../tooling/diagnostics/contracts.js";

export interface AssistantRuleMetadata {
  domain: AnalysisDomain;
  minimumProfile: AnalysisProfile;
  evidence: "deterministic" | "review";
  incomplete?: boolean;
}

function rule(
  domain: AnalysisDomain,
  minimumProfile: AnalysisProfile,
  evidence: AssistantRuleMetadata["evidence"],
): AssistantRuleMetadata {
  return { domain, minimumProfile, evidence };
}

/** 规则域与检查深度由稳定编号声明，不能从自然语言消息猜测。 */
export const ASSISTANT_DIAGNOSTIC_RULES: Readonly<
  Record<string, AssistantRuleMetadata>
> = {
  ...PROJECT_DIAGNOSTIC_RULES,
  VEXT_MCP_POLICY_RULE_UNRESOLVED: {
    ...rule("structure", "quick", "review"),
    incomplete: true,
  },
  VEXT_MCP_SERVICE_DB_TYPE_BYPASS: rule("services", "strict", "review"),
  VEXT_MCP_REDIS_ADAPTER_EAGER_CONFIG: rule(
    "configuration",
    "strict",
    "review",
  ),
  VEXT_MCP_UPLOAD_SVG_REVIEW: rule("configuration", "strict", "review"),
  VEXT_MCP_FORM_API_BOUNDARY_REVIEW: rule("frontend", "strict", "review"),
  VEXT_MCP_TEST_PLACEHOLDER_ASSERTION: rule(
    "testing",
    "strict",
    "deterministic",
  ),
  VEXT_MCP_SERVICE_DEPENDENCY_ANALYSIS_INCOMPLETE: {
    ...rule("services", "standard", "review"),
    incomplete: true,
  },
  VEXT_MCP_DEV_SCRIPT_WORKAROUND_REVIEW: rule(
    "dependencies",
    "quick",
    "review",
  ),
};
