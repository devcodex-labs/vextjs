import { describe, expect, it } from "vitest";
import {
  createAdapterInternalFailureError,
  createIncompatibleAdapterPeerDependencyError,
  createMissingAdapterPeerDependencyError,
  createUnknownAdapterError,
  isIncompatibleAdapterPeerDependencyError,
  isMissingAdapterPeerDependencyError,
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

  it("classifies missing optional peers by package name instead of broad import errors", () => {
    const missingPeer = Object.assign(
      new Error(
        "Cannot find package 'fastify' imported from E:/app/node_modules/vextjs/dist/adapters/fastify/adapter.js",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    const missingInternalModule = Object.assign(
      new Error(
        "Cannot find module './internal-runtime.js' imported from E:/app/node_modules/vextjs/dist/adapters/fastify/adapter.js",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    expect(isMissingAdapterPeerDependencyError(missingPeer, ["fastify"])).toBe(
      true,
    );
    expect(
      isMissingAdapterPeerDependencyError(missingInternalModule, ["fastify"]),
    ).toBe(false);
  });

  it("preserves missing-peer install hints with the original cause", () => {
    const cause = Object.assign(new Error("Cannot find module 'express'"), {
      code: "MODULE_NOT_FOUND",
    });
    const error = createMissingAdapterPeerDependencyError(
      "express",
      {
        peerPackages: ["express"],
        requiresText: 'the "express" package',
        installText: "Install it with: npm install express",
      },
      cause,
    );

    expect(error.message).toContain(
      'Adapter "express" requires the "express" package',
    );
    expect(error.message).toContain("npm install express");
    expect((error as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it("surfaces incompatible peer entries without rewriting them as install hints", () => {
    const cause = Object.assign(
      new Error(
        'Package subpath "./adapter" is not defined by "exports" in node_modules/fastify/package.json',
      ),
      { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
    );

    expect(isIncompatibleAdapterPeerDependencyError(cause, ["fastify"])).toBe(
      true,
    );

    const error = createIncompatibleAdapterPeerDependencyError(
      "fastify",
      cause,
    );
    expect(error.message).toContain("installed peer versions");
    expect(error.message).not.toContain("npm install fastify");
    expect((error as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it("surfaces internal adapter failures without missing-peer install hints", () => {
    const cause = new Error("adapter internal boot failure");
    const error = createAdapterInternalFailureError("fastify", cause);

    expect(error.message).toContain(
      'Adapter "fastify" failed while loading or initializing',
    );
    expect(error.message).toContain("adapter internal boot failure");
    expect(error.message).not.toContain("npm install fastify");
    expect((error as Error & { cause?: unknown }).cause).toBe(cause);
  });
});
