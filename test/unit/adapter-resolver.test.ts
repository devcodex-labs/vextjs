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

function createStaleCustomAdapter() {
  return {
    name: "stale-custom",
    createServer() {},
    registerMiddleware() {},
    registerRoute() {},
    registerErrorHandler() {},
    registerNotFoundHandler() {},
    registerOpenAPIRoutes() {},
    async listen() {
      return { close: async () => undefined, port: 3000, host: "127.0.0.1" };
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

  it("rejects stale custom adapter objects with old interface members", async () => {
    await expect(
      resolveAdapter(
        { adapter: createStaleCustomAdapter() } as unknown as VextConfig,
        {} as VextApp,
      ),
    ).rejects.toThrow(
      /Custom adapter "stale-custom" is missing required method: "registerNotFound"/,
    );
  });

  it("rejects custom adapter objects with invalid names", async () => {
    await expect(
      resolveAdapter(
        { adapter: { ...createCustomAdapter(), name: "" } } as VextConfig,
        {} as VextApp,
      ),
    ).rejects.toThrow(/missing required property: "name"/);
  });

  it("points custom adapter diagnostics at the current adapters guide", async () => {
    await expect(
      resolveAdapter(
        {
          adapter: { ...createCustomAdapter(), buildHandler: undefined },
        } as unknown as VextConfig,
        {} as VextApp,
      ),
    ).rejects.toThrow(/see the adapters guide/);
  });

  it("shares actionable unknown-adapter diagnostics with config validation", () => {
    const expected = createUnknownAdapterError("custom-name").message;
    expect(() => _validateConfig({ adapter: "custom-name" })).toThrow(expected);
  });
});
