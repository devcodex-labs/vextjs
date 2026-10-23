import { describe, expect, it } from "vitest";
import { validateVersionContract } from "../../scripts/check-version-sync.mjs";

function input(overrides: Record<string, unknown> = {}) {
  const stable = "1.0.2";
  const next = "2.0.0";
  return {
    packageVersion: next,
    lockVersion: next,
    lockRootVersion: next,
    channels: { stable, next, channel: "next" },
    release: false,
    files: {
      rspress:
        'import docsVersions from "./version-channels.json"; docsVersions.stable; docsVersions.next; docsVersions.channel;',
      readme: "npm install vextjs",
      cli: {
        en: `vext --version; output vextjs v${stable}`,
        zh: `vext --version; 输出 vextjs v${stable}`,
      },
      quickStart: {
        en: "npm install vextjs; npx vextjs create app",
        zh: "npm install vextjs; npx vextjs create app",
      },
    },
    ...overrides,
  };
}

describe("version channel contract", () => {
  it("allows an unreleased source candidate without advertising it as stable", () => {
    expect(validateVersionContract(input()).errors).toEqual([]);
  });

  it.each(["stable", "next"])(
    "accepts version-agnostic Quick Starts and CLI output without a source banner on %s",
    (channel) => {
      const current = input({
        channels: {
          stable: channel === "stable" ? "2.0.0" : "1.0.2",
          next: "2.0.0",
          channel,
        },
      });
      for (const locale of ["en", "zh"] as const) {
        current.files.cli[locale] =
          `vext --version; vextjs v${current.channels.stable}`;
        expect(current.files.quickStart[locale]).not.toMatch(/v\d+\.\d+\.\d+/);
        if (channel === "next")
          expect(current.files.cli[locale]).not.toContain("v2.0.0");
      }
      expect(validateVersionContract(current).errors).toEqual([]);
    },
  );

  it("still rejects an incorrect published command output in either locale", () => {
    for (const locale of ["en", "zh"] as const) {
      const current = input();
      current.files.cli[locale] = "vext --version; vextjs v0.0.0";
      expect(
        validateVersionContract(current).errors.map(
          (error) => error.description,
        ),
      ).toContain(
        `${locale} CLI page identifies the published stable command output`,
      );
    }
  });

  it("keeps the current next state fail-closed for a tag release", () => {
    const result = validateVersionContract(input({ release: true }));
    expect(result.errors.map((error) => error.description)).toEqual(
      expect.arrayContaining([
        "release requires the public stable version to match package.json",
        "release requires website channel=stable",
      ]),
    );
  });

  it("accepts an exact stable release state", () => {
    const version = "2.0.0";
    const current = input({
      channels: { stable: version, next: version, channel: "stable" },
      release: true,
    });
    current.files.cli = {
      en: `vext --version; output vextjs v${version}`,
      zh: `vext --version; 输出 vextjs v${version}`,
    };
    expect(validateVersionContract(current).errors).toEqual([]);
  });

  it("accepts a prerelease only on next while preserving published stable", () => {
    const version = "2.1.0-rc.1";
    const stable = "1.0.2";
    const current = input({
      packageVersion: version,
      lockVersion: version,
      lockRootVersion: version,
      channels: { stable, next: version, channel: "next" },
      release: true,
    });
    current.files.cli = {
      en: `vext --version; output vextjs v${stable}`,
      zh: `vext --version; 输出 vextjs v${stable}`,
    };

    expect(validateVersionContract(current).errors).toEqual([]);
  });

  it("rejects a prerelease labelled as the stable docs channel", () => {
    const version = "2.1.0-beta.2";
    const result = validateVersionContract(
      input({
        packageVersion: version,
        lockVersion: version,
        lockRootVersion: version,
        channels: { stable: "1.0.2", next: version, channel: "stable" },
        release: true,
      }),
    );
    expect(result.errors.map((error) => error.description)).toContain(
      "prerelease requires website channel=next",
    );
  });

  it("rejects a version-pinned general install command", () => {
    const current = input();
    current.files.quickStart.en =
      "docs v2.0.0; stable v1.0.2; npm install vextjs@2.0.0";
    expect(
      validateVersionContract(current).errors.map((error) => error.description),
    ).toContain(
      "en Quick Start keeps general install commands version-agnostic",
    );
  });

  it("rejects a version-pinned create command", () => {
    const current = input();
    current.files.quickStart.en += "; npx vextjs@2.0.0 create app";
    expect(
      validateVersionContract(current).errors.map((error) => error.description),
    ).toContain(
      "en Quick Start keeps general install commands version-agnostic",
    );
  });

  it("rejects a channel label that contradicts stable and next", () => {
    const result = validateVersionContract(
      input({
        channels: { stable: "1.0.2", next: "2.0.0", channel: "stable" },
      }),
    );
    expect(result.errors.map((error) => error.description)).toContain(
      "website channel label matches stable/next state",
    );
  });
});
