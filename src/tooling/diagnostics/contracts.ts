export const ANALYSIS_DOMAINS = [
  "routes",
  "services",
  "middlewares",
  "plugins",
  "configuration",
  "models",
  "frontend",
  "i18n",
  "jobs",
  "docs",
  "testing",
  "structure",
  "dependencies",
  "runtime",
] as const;
export type AnalysisDomain = (typeof ANALYSIS_DOMAINS)[number];
export type AnalysisProfile = "quick" | "standard" | "strict";

export interface ProjectDiagnosticMetadata {
  domain: AnalysisDomain;
  minimumProfile: AnalysisProfile;
  evidence: "deterministic" | "review";
  incomplete?: boolean;
}

export interface ProjectStaticDiagnostic extends ProjectDiagnosticMetadata {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  sourceFile?: string;
  recommendedAction: string;
}

const DOMAIN_ALIASES: Readonly<Record<string, AnalysisDomain>> = {
  config: "configuration",
  database: "models",
  tests: "testing",
  route: "routes",
  ratelimit: "configuration",
};

/** 明确别名取代对诊断正文的模糊匹配，拼错领域不会得到空的成功结果。 */
export function normalizeAnalysisDomain(
  value: string | undefined,
): AnalysisDomain | "all" | undefined {
  if (value === undefined || value === "all") return "all";
  const normalized = value.toLowerCase();
  if ((ANALYSIS_DOMAINS as readonly string[]).includes(normalized))
    return normalized as AnalysisDomain;
  return DOMAIN_ALIASES[normalized];
}

export function includesAnalysisProfile(
  selected: AnalysisProfile,
  minimum: AnalysisProfile,
): boolean {
  const order = { quick: 0, standard: 1, strict: 2 };
  return order[selected] >= order[minimum];
}
