import type { ProjectDependencyFact } from "../../tooling/project-index/dependencies.js";

export interface KnowledgeExample {
  id: string;
  purpose: string;
  language: "typescript";
  code: string;
  filePath: string;
  supportFiles?: Record<string, string>;
  prerequisites: string[];
  verification: { typeTest: string; runtimeTest?: string };
}

/** 随包审查的知识版本与消费者实际安装版本分别记录，不能由 semver 范围推断兼容。 */
export interface DependencyKnowledge {
  packageName: string;
  reviewedVersions: string[];
  reviewedOn: string;
  evidence: { officialUrls: string[]; installedPackageFiles: string[] };
  entryPoints: string[];
  prerequisites: string[];
  guidance: string[];
  limitations: string[];
  examples: KnowledgeExample[];
}

export interface DependencyKnowledgeEntry {
  id: string;
  summary: string;
  dependency: DependencyKnowledge;
}

export function knowledgeApplicability(
  knowledge: DependencyKnowledge,
  facts: readonly ProjectDependencyFact[] = [],
) {
  const relevant = facts.filter((fact) => fact.name === knowledge.packageName);
  return {
    status: relevant.length ? "inspected" : "unverified",
    owners: relevant.map((fact) => ({
      owner: fact.owner,
      declaredRange: fact.declaredRange,
      installedVersion: fact.version,
      state:
        fact.state !== "resolved" || !fact.version
          ? "unverified"
          : knowledge.reviewedVersions.includes(fact.version)
            ? "reviewed-version"
            : "version-mismatch",
      reason: fact.reason ?? null,
    })),
    runtime: "unverified",
    nextStep:
      "Use vext_project_inspect dependencies for owner evidence. A reviewed version is documentation/type applicability; the host must verify project configuration and runtime behavior. For a mismatch, review that installed version's official API before applying examples.",
  };
}
