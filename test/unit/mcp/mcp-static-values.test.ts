import { describe, expect, it } from "vitest";
import {
  readStaticDefault,
  staticMember,
  staticFact,
  mergeStaticValues,
} from "../../../src/tooling/project-index/static-values.js";

function field(source: string, path: string) {
  let value: ReturnType<typeof readStaticDefault> | undefined =
    readStaticDefault("config.ts", source);
  for (const key of path.split("."))
    value = value === undefined ? undefined : staticMember(value, key);
  return staticFact(value, ["config.ts"]);
}

describe("MCP field-level static configuration", () => {
  it("preserves known settings beside unrelated dynamic expressions", () => {
    const source =
      "const enabled = true; export default { dev: { mcp: { enabled } }, database: { uri: process.env.MONGO_URI } };";
    expect(field(source, "dev.mcp.enabled")).toMatchObject({
      state: "known",
      value: true,
    });
    expect(field(source, "database.uri")).toMatchObject({ state: "unknown" });
    expect(field(source, "jobs")).toMatchObject({ state: "absent" });
  });

  it("respects property order around dynamic spreads", () => {
    expect(
      field("export default { ...dynamic, enabled: true };", "enabled"),
    ).toMatchObject({ state: "known", value: true });
    expect(
      field("export default { enabled: true, ...dynamic };", "enabled"),
    ).toMatchObject({ state: "unknown" });
    expect(field("export default { ...dynamic };", "missing")).toMatchObject({
      state: "unknown",
    });
  });

  it("does not unwrap arbitrary one-argument functions", () => {
    expect(
      field("export default changeConfig({ enabled: true });", "enabled"),
    ).toMatchObject({ state: "unknown" });
  });

  it("does not turn invalid syntax into absent config", () => {
    expect(field("export default { enabled: ;", "enabled")).toMatchObject({
      state: "invalid",
    });
  });

  it("merges nested objects while replacing arrays and unknown overrides", () => {
    const base = readStaticDefault(
      "default.ts",
      "export default { dev: { mcp: { enabled: true, hosts: ['codex'] } } };",
    );
    const override = readStaticDefault(
      "local.ts",
      "export default { dev: { mcp: { hosts: ['vscode'], enabled: process.env.MCP } } };",
    );
    const merged = mergeStaticValues(base, override);
    const mcp = staticMember(staticMember(merged, "dev")!, "mcp")!;
    expect(staticFact(staticMember(mcp, "hosts"), [])).toMatchObject({
      state: "known",
      value: ["vscode"],
    });
    expect(staticFact(staticMember(mcp, "enabled"), [])).toMatchObject({
      state: "unknown",
    });
  });

  it("does not execute getters or trust mutated local objects", () => {
    expect(
      field(
        "export default { get enabled() { throw new Error('never execute'); } };",
        "enabled",
      ).state,
    ).toBe("unknown");
    expect(
      field(
        "const config = { enabled: true }; config.enabled = false; export default config;",
        "enabled",
      ).state,
    ).toBe("unknown");
  });

  it("reads literal CommonJS config without executing require", () => {
    expect(
      field(
        "module.exports = { enabled: false, client: require('redis') };",
        "enabled",
      ),
    ).toMatchObject({ state: "known", value: false });
    expect(
      field(
        "module.exports = { enabled: false, client: require('redis') };",
        "client",
      ).state,
    ).toBe("unknown");
  });

  it("tracks object aliases and nested object escape", () => {
    expect(
      field(
        "const base = { enabled: true }; const alias = base; alias.enabled = false; export default base;",
        "enabled",
      ).state,
    ).toBe("unknown");
    expect(
      field(
        "const base = { enabled: true }; mutate({ nested: base }); export default base;",
        "enabled",
      ).state,
    ).toBe("unknown");
  });
});
