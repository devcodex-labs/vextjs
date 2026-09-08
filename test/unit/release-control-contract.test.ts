import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyReleaseVersion } from "../../scripts/release-channel.mjs";
import { classifyReleaseEntry } from "../../scripts/release-entry.mjs";
import { verifyReleaseAncestry } from "../../scripts/verify-release-ancestry.mjs";

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function jobBlock(workflow: string, name: string): string {
  const start = workflow.indexOf(`  ${name}:`);
  expect(start).toBeGreaterThanOrEqual(0);
  const contentStart = start + name.length + 3;
  const rest = workflow.slice(contentStart);
  const next = rest.search(/^  [a-z0-9][a-z0-9-]*:\s*$/mu);
  return next === -1
    ? workflow.slice(start)
    : workflow.slice(start, contentStart + next);
}

describe("release control contract", () => {
  it("qualifies main manually without treating any manual event as publication", () => {
    expect(
      classifyReleaseEntry({
        eventName: "workflow_dispatch",
        ref: "refs/heads/main",
        version: "2.0.0",
      }),
    ).toBe("qualification");
    for (const ref of [
      "refs/heads/feature",
      "refs/tags/v2.0.0",
      "main",
      undefined,
    ]) {
      expect(() =>
        classifyReleaseEntry({
          eventName: "workflow_dispatch",
          ref,
          version: "2.0.0",
        }),
      ).toThrow("requires refs/heads/main");
    }
  });

  it("requires an exact pushed version tag for publication", () => {
    for (const version of ["2.0.0", "2.1.0-rc.1"]) {
      expect(
        classifyReleaseEntry({
          eventName: "push",
          ref: `refs/tags/v${version}`,
          version,
        }),
      ).toBe("publication");
    }
    for (const [eventName, ref] of [
      ["push", "refs/tags/v1.0.0"],
      ["push", "refs/heads/main"],
      ["pull_request", "refs/tags/v2.0.0"],
      [undefined, undefined],
    ]) {
      expect(() =>
        classifyReleaseEntry({ eventName, ref, version: "2.0.0" }),
      ).toThrow("requires a pushed tag");
    }
  });

  it("gates all qualification jobs and isolates manual qualification from publication", () => {
    const release = read(".github/workflows/release.yml");
    const version = jobBlock(release, "version-check");
    expect(release).toMatch(/^  workflow_dispatch:\s*$/mu);
    expect(version).toContain("run: node scripts/release-entry.mjs");
    expect(version).toContain(
      "if: github.event_name == 'workflow_dispatch'\n        run: bash scripts/check-version-sync.sh\n",
    );
    expect(version).toContain(
      "if: github.event_name == 'push'\n        run: bash scripts/check-version-sync.sh --release",
    );
    for (const job of ["ci", "docs-build"]) {
      expect(jobBlock(release, job)).toContain("needs: version-check");
    }
    const publish = jobBlock(release, "publish");
    expect(publish).toContain(
      "if: github.event_name == 'push' && github.ref_type == 'tag'",
    );
    // Every remote publishing step remains inside the independently guarded job.
    expect(release.slice(0, release.indexOf("  publish:"))).not.toMatch(
      /run:.*npm publish|uses: softprops\/action-gh-release/u,
    );
  });

  it("maps stable and prerelease SemVer to one channel tuple", () => {
    expect(classifyReleaseVersion("2.0.0")).toEqual({
      version: "2.0.0",
      releaseChannel: "stable",
      npmDistTag: "latest",
      githubPrerelease: false,
    });
    expect(classifyReleaseVersion("2.1.0-rc.1+build.7")).toEqual({
      version: "2.1.0-rc.1+build.7",
      releaseChannel: "next",
      npmDistTag: "next",
      githubPrerelease: true,
    });
    expect(() => classifyReleaseVersion("2.1.0-01")).toThrow(
      "numeric prerelease has a leading zero",
    );
    expect(() => classifyReleaseVersion("v2.0.0")).toThrow(
      "invalid semantic version",
    );
  });

  it("fails ancestry when the candidate is not contained in origin/main", () => {
    const passStatuses = [0, 0, 0];
    const pass = verifyReleaseAncestry({
      candidate: "candidate",
      upstream: "origin/main",
      runGit: () => ({ status: passStatuses.shift() }),
    });
    expect(pass.ok).toBe(true);

    const failStatuses = [0, 0, 1];
    const fail = verifyReleaseAncestry({
      candidate: "candidate",
      upstream: "origin/main",
      runGit: () => ({ status: failStatuses.shift() }),
    });
    expect(fail).toMatchObject({
      ok: false,
      message: "candidate is not an ancestor of origin/main",
    });
  });

  it("uses the resolved channel and full-history ancestry before publishing", () => {
    const release = read(".github/workflows/release.yml");
    const publish = jobBlock(release, "publish");
    const ancestryIndex = publish.indexOf("npm run verify:release-ancestry");
    const publishIndex = publish.indexOf("npm publish");

    expect(publish).toContain("fetch-depth: 0");
    expect(publish).toContain("scripts/release-channel.mjs");
    expect(publish).toContain("main:refs/remotes/origin/main");
    expect(ancestryIndex).toBeGreaterThanOrEqual(0);
    expect(publishIndex).toBeGreaterThan(ancestryIndex);
    expect(publish).toContain(
      '--tag "${{ steps.release-channel.outputs.npm_dist_tag }}"',
    );
    expect(publish).toContain('npm publish "${VEXT_PREFLIGHT_VEXT_TARBALL}"');
    expect(publish).not.toContain("npm publish --ignore-scripts");
    expect(publish).toContain(
      "steps.release-channel.outputs.github_prerelease == 'true'",
    );
    expect(publish).not.toContain('== *"-"*');

    const preflight = read("scripts/release-preflight.mjs");
    expect(preflight).toContain("import { classifyReleaseVersion }");
    expect(preflight).toContain("scripts/verify-release-ancestry.mjs");
    expect(preflight).toContain("scripts/check-version-sync.mjs");
    expect(preflight).toContain("VEXT_PREFLIGHT_CANDIDATE_RECEIPT");
    expect(preflight).toContain("verifyReleaseCandidateSourceInputs");
  });

  it("qualifies one frozen tarball through the external four-cell matrix", () => {
    const release = read(".github/workflows/release.yml");
    const freeze = jobBlock(release, "freeze-candidate");
    const external = jobBlock(release, "external-consumer");
    const aggregate = jobBlock(release, "aggregate-evidence");
    const publish = jobBlock(release, "publish");

    expect(freeze).toContain("needs: [ci, version-check, docs-build]");
    expect(freeze).toContain("repository: devcodex-labs/vextjs-test");
    expect(freeze).toContain(
      "consumer-commit: ${{ steps.consumer-checkout.outputs.commit }}",
    );
    expect(freeze).toContain(
      "VEXTJS_TEST_TOKEN: ${{ secrets.VEXTJS_TEST_TOKEN || secrets.VEXTJS_GH_PAGES_TOKEN }}",
    );
    expect(freeze).toContain("persist-credentials: false");
    expect(freeze).toContain("npm run freeze:release-candidate");
    expect(freeze).toContain("actions/upload-artifact@v7");
    expect(freeze).toContain(
      "vextjs-release-candidate-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(freeze.indexOf("npm run freeze:release-candidate")).toBeLessThan(
      freeze.indexOf("Checkout external consumer main for commit resolution"),
    );

    expect(external).toContain("os: [ubuntu-latest, windows-latest]");
    expect(external).toContain("node-version: [20, 22]");
    expect(external).toContain("repository: devcodex-labs/vextjs-test");
    expect(external).toContain(
      "token: ${{ secrets.VEXTJS_TEST_TOKEN || secrets.VEXTJS_GH_PAGES_TOKEN }}",
    );
    expect(external).toContain("persist-credentials: false");
    expect(external).toContain(
      "ref: ${{ needs.freeze-candidate.outputs.consumer-commit }}",
    );
    expect(external).toContain("actions/download-artifact@v8");
    expect(external).toContain("run-external-consumer-cell.mjs");
    expect(external).toContain(
      "--consumer-root '${{ github.workspace }}/external-consumer'",
    );
    expect(external).not.toContain("--consumer-cwd");
    expect(external).toContain('--material-prefix "cells/$cell"');
    expect(external).toContain(
      "vextjs-external-cell-${{ matrix.os }}-node${{ matrix.node-version }}",
    );

    expect(aggregate).toContain(
      "if: always() && needs.freeze-candidate.result == 'success'",
    );
    expect(aggregate).toContain("needs: [freeze-candidate, external-consumer]");
    expect(aggregate).toContain("pattern: vextjs-external-cell-*");
    expect(aggregate).toContain("merge-multiple: true");
    expect(aggregate).toContain("assemble-external-evidence.mjs");
    expect(aggregate).toContain("actions/upload-artifact@v7");
    expect(aggregate).toContain(
      "vextjs-qualified-release-${{ github.run_id }}-${{ github.run_attempt }}",
    );

    expect(publish).toContain("needs: aggregate-evidence");
    expect(publish).toContain("actions/download-artifact@v8");
    expect(publish).toContain("VEXT_PREFLIGHT_VEXT_TARBALL=");
    expect(publish).toContain("VEXT_PREFLIGHT_CANDIDATE_RECEIPT=");
    expect(publish).toContain("VEXT_EXTERNAL_EVIDENCE_FILE=");
    expect(publish.indexOf("release:preflight:final")).toBeLessThan(
      publish.indexOf("npm publish"),
    );
    expect(publish).toContain('npm publish "${VEXT_PREFLIGHT_VEXT_TARBALL}"');
  });

  it("runs one thresholded coverage script in CI and preflight", () => {
    const ci = read(".github/workflows/ci.yml");
    const coverage = jobBlock(ci, "coverage");
    const preflight = read("scripts/release-preflight.mjs");
    const config = read("vitest.config.ts");

    expect(coverage).toContain("npm run test:cov");
    expect(coverage).not.toContain("npx vitest run --coverage");
    expect(preflight).toContain('["coverage", npm, ["run", "test:cov"]]');
    expect(config).toMatch(/lines:\s*79/u);
    expect(config).toMatch(/statements:\s*78/u);
    expect(config).toMatch(/functions:\s*81/u);
    expect(config).toMatch(/branches:\s*70/u);
    expect(config).toMatch(/autoUpdate:\s*false/u);
  });

  it("documents built-in rate limiting instead of a permanent throttle Map", () => {
    const en = read("website/docs/en/api/plugin-api.md");
    const zh = read("website/docs/zh/api/plugin-api.md");

    for (const document of [en, zh]) {
      expect(document).not.toContain("const store = new Map");
      expect(document).toContain("rateLimit:");
      expect(document).toContain("app.setRateLimiter()");
    }
    expect(en).toContain("process-local");
    expect(en).toContain("shared backend");
    expect(zh).toContain("单进程");
    expect(zh).toContain("共享后端");
  });
});
