import { describe, expect, it } from "vitest";
import {
  resolveAssistantPolicy,
  applyAssistantDiagnosticPolicy,
} from "../../../src/assistant/policy.js";
import type { VextMcpProjectDiagnostic } from "../../../src/assistant/project-diagnostics.js";

const advice: VextMcpProjectDiagnostic = {
  code: "VEXT_MCP_SERVICE_DB_TYPE_BYPASS",
  domain: "services",
  severity: "warning",
  minimumProfile: "strict",
  evidence: "review",
  message: "Review a database helper.",
  recommendedAction: "Review the actual model API.",
  affectedCapabilityIds: ["C05"],
};
describe("MCP effective diagnostic policy", () => {
  it("does not treat inherited object properties as implemented rule ids", () => {
    const result = applyAssistantDiagnosticPolicy(
      [],
      resolveAssistantPolicy(undefined, {
        rules: [{ id: "toString", level: "warning" }],
      }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({
        code: "VEXT_MCP_POLICY_RULE_UNRESOLVED",
        incomplete: true,
      }),
    );
  });

  it("applies convention levels without changing the baseline diagnostics", () => {
    const off = resolveAssistantPolicy(undefined, {
      rules: [{ id: advice.code, level: "off" }],
    });
    expect(applyAssistantDiagnosticPolicy([advice], off)).toEqual([]);
    const error = resolveAssistantPolicy(undefined, {
      rules: [{ id: advice.code, level: "error" }],
    });
    expect(applyAssistantDiagnosticPolicy([advice], error)[0]?.severity).toBe(
      "error",
    );
    expect(advice.severity).toBe("warning");
  });
  it("does not disable validity checks or silently claim unknown project rules are checked", () => {
    const invalid: VextMcpProjectDiagnostic = {
      ...advice,
      code: "VEXT_MCP_CONFIG_INVALID",
      severity: "error",
      evidence: "deterministic",
    };
    const result = applyAssistantDiagnosticPolicy(
      [invalid],
      resolveAssistantPolicy(undefined, {
        rules: [
          { id: invalid.code, level: "off" },
          { id: "company-review-rule", level: "warning" },
        ],
      }),
    );
    expect(result[0]?.severity).toBe("error");
    expect(result.filter((item) => item.incomplete)).toHaveLength(2);
  });
});
