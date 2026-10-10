import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function workflow(name: string): string {
  return readFileSync(
    path.join(process.cwd(), ".github", "workflows", name),
    "utf8",
  );
}

function script(name: string): string {
  return readFileSync(path.join(process.cwd(), "scripts", name), "utf8");
}

function deploymentGraph(): Map<string, string[]> {
  const jobs = new Map<string, string[]>();
  for (const match of workflow("docs.yml").matchAll(
    /^  ([a-z][a-z-]+):\s*\n([\s\S]*?)(?=^  [a-z][a-z-]+:|$(?![\s\S]))/gmu,
  )) {
    const dependencies = match[2].match(/^    needs: (.+)$/mu)?.[1];
    jobs.set(
      match[1],
      dependencies
        ?.trim()
        .replace(/[\[\]]/gu, "")
        .split(/,\s*/u) ?? [],
    );
  }
  return jobs;
}

// GitHub skips a job when any required dependency fails. Traverse the actual
// workflow graph so an indirect shared dependency cannot restore the coupling.
function blockedByFailure(graph: Map<string, string[]>, failed: string) {
  const blocked = new Set([failed]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [job, dependencies] of graph) {
      if (!blocked.has(job) && dependencies.some((need) => blocked.has(need))) {
        blocked.add(job);
        changed = true;
      }
    }
  }
  return blocked;
}

describe("main CI and deployment workflow contract", () => {
  it("runs push CI on main while retaining pull requests to main", () => {
    const ci = workflow("ci.yml");
    expect(ci).toMatch(/push:\s*\n\s+branches: \[main\]/u);
    expect(ci).toMatch(/pull_request:\s*\n\s+branches: \[main\]/u);
    expect(ci).not.toContain('branches: ["*"]');
    expect(ci).toContain("bash scripts/check-version-sync.sh");
  });

  it("requires the coverage job on pull requests as well as main pushes", () => {
    const ci = workflow("ci.yml");
    const coverageJob = ci.match(
      /^  coverage:\s*$([\s\S]*?)(?=^  [a-z][a-z-]+:\s*$)/mu,
    )?.[1];

    expect(coverageJob).toBeDefined();
    expect(coverageJob).not.toMatch(/if:\s*github\.event_name == 'push'/u);
    expect(ci).toMatch(/needs:[\s\S]*coverage,[\s\S]*docs-build,/u);
    expect(ci).toContain("${{ needs.coverage.result }}");
  });

  it("uses a tracked ignore source for reproducible Prettier checks", () => {
    const ci = workflow("ci.yml");
    const formatCheck = script("format-check.mjs");

    expect(formatCheck).toContain('"--ignore-path"');
    expect(formatCheck).toContain('".gitignore"');
    expect(formatCheck).toContain("FORMAT_CHECK_BASE");
    expect(formatCheck).toContain('process.env.CI === "true"');
    expect(ci).toContain("fetch-depth: 0");
    expect(ci).toContain(
      "github.event.pull_request.base.sha || github.event.before",
    );
  });

  it("keeps exact public-version validation in the tag release", () => {
    expect(workflow("release.yml")).toMatch(
      /push:\s*\n\s+tags:\s*\n\s+- "v\*"/u,
    );
    expect(workflow("release.yml")).toContain(
      "bash scripts/check-version-sync.sh --release",
    );
  });

  it("deploys only the exact successful main push CI commit", () => {
    const docs = workflow("docs.yml");
    expect(docs).toContain("workflow_run:");
    expect(docs).toContain("workflows: [CI]");
    expect(docs).toContain("types: [completed]");
    expect(docs).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(docs).toContain("github.event.workflow_run.event == 'push'");
    expect(docs).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(docs).toContain("github.event.workflow_run.head_sha || github.sha");
    expect(workflow("docs-build.yml")).toContain("ref: ${{ env.DEPLOY_SHA }}");
    expect(docs).not.toMatch(/^\s{2}push:/mu);
  });

  it.each([
    ["build-organization", "deploy-organization", "deploy-pages"],
    ["build-project", "deploy-pages", "deploy-organization"],
  ])(
    "isolates %s failure while blocking its own publication",
    (failed, own, other) => {
      const graph = deploymentGraph();
      expect(graph.has(failed)).toBe(true);
      expect(graph.has(own)).toBe(true);
      expect(graph.has(other)).toBe(true);
      const blocked = blockedByFailure(graph, failed);
      expect(blocked.has(own)).toBe(true);
      expect(blocked.has(other)).toBe(false);
    },
  );

  it("keeps organization publication failure outside the source publication dependency chain", () => {
    expect(
      blockedByFailure(deploymentGraph(), "deploy-organization").has(
        "deploy-pages",
      ),
    ).toBe(false);
  });

  it("runs complete publishing checks for both independent build callers", () => {
    const docs = workflow("docs.yml");
    expect(
      docs.match(/uses: \.\/\.github\/workflows\/docs-build\.yml/gu),
    ).toHaveLength(2);
    expect(docs).toContain("base: /vextjs/");
    expect(docs).toContain("base: /\n");
    const build = workflow("docs-build.yml");
    expect(build).toContain("workflow_call:");
    expect(build).toContain("DEPLOY_SHA: ${{ inputs.sha }}");
    expect(build).toContain("npm run build:publish -- --rollout=final");
    expect(build).toContain("docs-dist-${{ inputs.site }}");
    expect(build).toContain("if: inputs.site == 'project'");
    expect(build).toContain("actions/upload-pages-artifact@v5");
  });
});
