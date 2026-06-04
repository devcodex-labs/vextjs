import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  applyServerConfig,
  createNodeServerOptions,
  hasServerConfig,
} from "../../src/lib/server-config.js";

describe("server-config", () => {
  it("detects whether server config has explicit fields", () => {
    expect(hasServerConfig()).toBe(false);
    expect(hasServerConfig({})).toBe(false);
    expect(hasServerConfig({ requestTimeout: 0 })).toBe(true);
  });

  it("maps constructor-level Node HTTP server options", () => {
    const options = createNodeServerOptions({
      requestTimeout: 120_000,
      headersTimeout: 60_000,
      keepAliveTimeout: 5_000,
      maxHeaderSize: 8 * 1024,
      connectionsCheckingInterval: 1_000,
    });

    expect(options).toEqual({
      requestTimeout: 120_000,
      headersTimeout: 60_000,
      keepAliveTimeout: 5_000,
      maxHeaderSize: 8 * 1024,
      connectionsCheckingInterval: 1_000,
    });
  });

  it("applies mutable Node HTTP server properties including zero values", () => {
    const server = createServer();

    applyServerConfig(server, {
      requestTimeout: 0,
      headersTimeout: 0,
      keepAliveTimeout: 0,
      socketTimeout: 0,
      maxRequestsPerSocket: 1,
    });

    expect(server.requestTimeout).toBe(0);
    expect(server.headersTimeout).toBe(0);
    expect(server.keepAliveTimeout).toBe(0);
    expect(server.timeout).toBe(0);
    expect(server.maxRequestsPerSocket).toBe(1);
  });
});
