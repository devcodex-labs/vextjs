import { describe, expect, it } from "vitest";
import {
  createUnknownAdapterError,
  resolveAdapter,
} from "../../src/lib/adapter-resolver.js";
import { _validateConfig } from "../../src/lib/config-loader.js";
import type { VextAdapter } from "../../src/types/adapter.js";
import type { VextApp, VextConfig } from "../../src/types/app.js";

function createCustomAdapter(): VextAdapter {
  return {
    name: "custom",
    registerRoute() {},
    registerMiddleware() {},
    registerErrorHandler() {},
    registerNotFound() {},
    async listen() {
      return { close: async () => undefined, port: 3000, host: "127.0.0.1" };
    },
    buildHandler() {
      return () => undefined;
    },
  };
}

describe("adapter resolver configuration contract", () => {
  it("accepts and returns a documented adapter object instance", async () => {
    const adapter = createCustomAdapter();
    expect(() => _validateConfig({ adapter })).not.toThrow();

    const resolved = await resolveAdapter(
      { adapter } as VextConfig,
      {} as VextApp,
    );
    expect(resolved).toBe(adapter);
  });

  it("shares actionable unknown-adapter diagnostics with config validation", () => {
    const expected = createUnknownAdapterError("custom-name").message;
    expect(() => _validateConfig({ adapter: "custom-name" })).toThrow(expected);
  });
});
