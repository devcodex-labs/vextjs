import { describe, expect, it } from "vitest";
import {
  createVextApiClient,
  VextApiError,
} from "../../src/frontend/contract/api-client.js";
import type { VextClientContract } from "../../src/frontend/contract/types.js";

const contract: VextClientContract = {
  schemaVersion: 1,
  kind: "client-contract",
  source: "routes-manifest",
  generatedAt: "2026-09-09T00:00:00.000Z",
  routes: [],
  warnings: [],
};

describe("API responses without a message body", () => {
  it.each([204, 205])("returns null for JSON-labelled %s", async (status) => {
    const client = createVextApiClient(contract, {
      baseUrl: "http://localhost",
      fetch: async () =>
        new Response(null, {
          status,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(client.GET("/empty")).resolves.toBeNull();
  });

  it("does not parse a HEAD response even when its GET representation is JSON", async () => {
    const client = createVextApiClient(contract, {
      baseUrl: "http://localhost",
      fetch: async () =>
        new Response(null, {
          headers: {
            "content-type": "application/json",
            "content-length": "128",
          },
        }),
    });
    await expect(client.HEAD("/empty")).resolves.toBeNull();
  });

  it("preserves the HTTP error for a bodyless 304", async () => {
    const client = createVextApiClient(contract, {
      baseUrl: "http://localhost",
      fetch: async () =>
        new Response(null, {
          status: 304,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(client.GET("/empty")).rejects.toMatchObject({
      constructor: VextApiError,
      status: 304,
      rawBody: null,
    });
  });

  it("still rejects malformed JSON in an ordinary response", async () => {
    const client = createVextApiClient(contract, {
      baseUrl: "http://localhost",
      fetch: async () =>
        new Response("{broken", {
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(client.GET("/broken")).rejects.toBeInstanceOf(SyntaxError);
  });
});
