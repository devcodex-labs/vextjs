import {
  normalizePolicyPatch,
  type NormalizedVextAssistantPolicy,
  type VextAssistantPolicyPatch,
} from "./contracts.js";
import { ASSISTANT_DIAGNOSTIC_RULES } from "./diagnostic-rules.js";
import type { VextMcpProjectDiagnostic } from "./project-diagnostics.js";

/** 请求覆盖仅作用于本次上下文；不会修改工作区策略或共享给其他 MCP 调用。 */
export function resolveAssistantPolicy(
  base: VextAssistantPolicyPatch | undefined,
  override: VextAssistantPolicyPatch | undefined,
): NormalizedVextAssistantPolicy {
  const rules = new Map((base?.rules ?? []).map((rule) => [rule.id, rule]));
  for (const rule of override?.rules ?? []) rules.set(rule.id, rule);
  const normalized = normalizePolicyPatch({
    ...base,
    ...override,
    ...(base?.roles || override?.roles
      ? { roles: { ...base?.roles, ...override?.roles } }
      : {}),
    ...(base?.scripts || override?.scripts
      ? { scripts: { ...base?.scripts, ...override?.scripts } }
      : {}),
    ...(base?.naming || override?.naming
      ? { naming: { ...base?.naming, ...override?.naming } }
      : {}),
    ...(base?.rules || override?.rules
      ? { rules: [...rules.values()].sort((a, b) => a.id.localeCompare(b.id)) }
      : {}),
  });
  if (!normalized.ok) throw new Error(normalized.failure.message);
  return normalized.value;
}

/** 约定级别可覆盖；语法、运行配置有效性及事实缺失不能通过关闭提示变成 valid。 */
export function applyAssistantDiagnosticPolicy(
  diagnostics: readonly VextMcpProjectDiagnostic[],
  policy: NormalizedVextAssistantPolicy,
): VextMcpProjectDiagnostic[] {
  const protectedRules = new Set([
    "VEXT_MCP_SOURCE_SYNTAX_ERROR",
    "VEXT_MCP_ROUTE_RESPONSE_SCHEMA_INVALID",
    "VEXT_MCP_SERVICE_DEPENDENCY_INVALID",
    "VEXT_MCP_CONFIG_INVALID",
    "VEXT_MCP_RATE_LIMIT_REDIS_TARGET_MISSING",
    "R01",
    "R02",
    "R03",
    "R04",
  ]);
  const overrides = new Map<string, "off" | "info" | "warning" | "error">();
  const unresolved: VextMcpProjectDiagnostic[] = [];
  for (const rule of policy.patch.rules ?? []) {
    const metadata = Object.hasOwn(ASSISTANT_DIAGNOSTIC_RULES, rule.id)
      ? ASSISTANT_DIAGNOSTIC_RULES[rule.id]
      : undefined;
    let reason: string | undefined;
    if (protectedRules.has(rule.id) || metadata?.incomplete) {
      if (rule.level !== "error")
        reason =
          "This rule protects validity or evidence completeness and cannot be weakened.";
    } else if (!metadata && rule.level !== "off")
      reason =
        "The framework has no executable checker for this user rule; the host must supply review evidence.";
    if (reason) {
      unresolved.push({
        severity: "info",
        code: "VEXT_MCP_POLICY_RULE_UNRESOLVED",
        domain: "structure",
        minimumProfile: "quick",
        evidence: "review",
        incomplete: true,
        message: `${rule.id}: ${reason}`,
        recommendedAction:
          "Keep the framework check and record the applicable project-rule review with the host.",
        affectedCapabilityIds: ["C02", "C27", "C28"],
      });
      continue;
    }
    overrides.set(rule.id, rule.level);
  }
  return [
    ...diagnostics.flatMap((diagnostic) => {
      const level = overrides.get(diagnostic.code);
      return level === "off"
        ? []
        : [{ ...diagnostic, severity: level ?? diagnostic.severity }];
    }),
    ...unresolved,
  ];
}
