import { describe, expect, it } from "vitest";
import {
  formatLegacyConfigProfileWarning,
  getDefaultConfigProfile,
  getDefaultRuntimeMode,
  isStandardRuntimeMode,
  resolveConfigProfile,
  validateConfigProfileName,
} from "../../src/lib/config-profile.js";

describe("config profile resolver", () => {
  it("maps commands to default runtime modes and config profiles", () => {
    expect(getDefaultRuntimeMode("start")).toBe("production");
    expect(getDefaultRuntimeMode("build")).toBe("production");
    expect(getDefaultRuntimeMode("dev")).toBe("development");
    expect(getDefaultRuntimeMode("test")).toBe("test");
    expect(getDefaultRuntimeMode()).toBe("development");

    expect(getDefaultConfigProfile("start")).toBe("production");
    expect(getDefaultConfigProfile("build")).toBe("production");
    expect(getDefaultConfigProfile("dev")).toBe("development");
    expect(getDefaultConfigProfile("test")).toBe("test");
  });

  it("uses --config before VEXT_CONFIG and legacy NODE_ENV", () => {
    const resolved = resolveConfigProfile({
      cliProfile: "us-uat",
      command: "start",
      env: {
        VEXT_CONFIG: "sg-sit",
        NODE_ENV: "legacy-sit",
      } as NodeJS.ProcessEnv,
    });

    expect(resolved).toEqual({ profile: "us-uat", source: "cli" });
  });

  it("uses VEXT_CONFIG before legacy NODE_ENV", () => {
    const resolved = resolveConfigProfile({
      command: "start",
      env: {
        VEXT_CONFIG: "sg-sit",
        NODE_ENV: "legacy-sit",
      } as NodeJS.ProcessEnv,
    });

    expect(resolved).toEqual({ profile: "sg-sit", source: "env" });
  });

  it("falls back to custom NODE_ENV with migration warning", () => {
    const resolved = resolveConfigProfile({
      command: "start",
      env: {
        NODE_ENV: "sg-sit",
      } as NodeJS.ProcessEnv,
    });

    expect(resolved.profile).toBe("sg-sit");
    expect(resolved.source).toBe("legacy-node-env");
    expect(resolved.warning).toBe(
      formatLegacyConfigProfileWarning("sg-sit", "start"),
    );
  });

  it("does not treat standard NODE_ENV values as config profiles", () => {
    expect(isStandardRuntimeMode("production")).toBe(true);
    expect(isStandardRuntimeMode("development")).toBe(true);
    expect(isStandardRuntimeMode("test")).toBe(true);
    expect(isStandardRuntimeMode("sg-sit")).toBe(false);

    const resolved = resolveConfigProfile({
      command: "start",
      env: {
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv,
    });

    expect(resolved).toEqual({ profile: "production", source: "default" });
  });

  it("uses displayCommand in legacy warning text", () => {
    const resolved = resolveConfigProfile({
      command: "build",
      displayCommand: "deploy assets",
      env: {
        NODE_ENV: "sg-sit",
      } as NodeJS.ProcessEnv,
    });

    expect(resolved.warning).toContain("vext deploy assets --config sg-sit");
  });

  it("rejects path-like, extension-like, empty, and reserved profiles", () => {
    expect(() => validateConfigProfileName("../prod")).toThrow("file basename");
    expect(() => validateConfigProfileName("prod.ts")).toThrow("file basename");
    expect(() => validateConfigProfileName("")).toThrow("must not be empty");
    expect(() => validateConfigProfileName("local")).toThrow("reserved");
    expect(() => validateConfigProfileName("bootstrap")).toThrow("reserved");
  });
});
