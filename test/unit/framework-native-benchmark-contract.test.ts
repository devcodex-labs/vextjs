import { describe, expect, it } from "vitest";
import {
  CANONICAL_JSON_VERSION,
  canonicalJsonStringify,
  canonicalizeJson,
  semanticHash,
} from "../benchmark/framework-native/canonical-json.mjs";
import {
  REQUIRED_SECURITY_HEADERS,
  computePricingChecksum,
  getWorkload,
  semanticResponseHash,
} from "../benchmark/framework-native/contract.mjs";
import {
  FRAMEWORK_NATIVE_IMPLEMENTATION_MANIFEST,
  assertImplementationManifest,
} from "../benchmark/framework-native/implementation-manifest.mjs";
import {
  assertArtifact,
  renderPending,
} from "../benchmark/framework-native/generate-framework-native-results.mjs";

function successResponse(requestId: string, id: string, reverse = false) {
  const order = {
    id,
    userId: "10001",
    sku: "SKU-CPU-001",
    quantity: 2,
    unitPrice: 19.5,
    currency: "USD",
    pricingChecksum: computePricingChecksum("SKU-CPU-001"),
    subtotal: 39,
    discount: 0,
    total: 39,
    pricingSource: "local-cpu",
  };
  const ordered = reverse
    ? Object.fromEntries(Object.entries(order).reverse())
    : order;
  return {
    status: 201,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...Object.fromEntries(
        Object.entries(REQUIRED_SECURITY_HEADERS).reverse(),
      ),
    },
    body: reverse
      ? {
          meta: {
            traceId: `trace-${requestId}`,
            tenantId: "benchmark-tenant",
            requestId,
          },
          data: { order: ordered },
        }
      : {
          data: { order: ordered },
          meta: {
            requestId,
            tenantId: "benchmark-tenant",
            traceId: `trace-${requestId}`,
          },
        },
  };
}

describe("Framework-native benchmark semantic contract", () => {
  it("canonicalizes JSON semantics without relying on serialized key order", () => {
    expect(CANONICAL_JSON_VERSION).toBe("c14n-json-v1");
    expect(
      canonicalJsonStringify({ beta: [2, -0], alpha: { z: true, a: null } }),
    ).toBe('{"alpha":{"a":null,"z":true},"beta":[2,0]}');
    expect(semanticHash({ left: 1, right: 2 })).toBe(
      semanticHash({ right: 2, left: 1 }),
    );
    expect(semanticHash({ left: 1, right: 2 })).not.toBe(
      semanticHash({ left: 1, right: 3 }),
    );
    expect(() => canonicalizeJson({ absent: undefined })).toThrow(
      "Unsupported JSON semantic value",
    );
  });

  it("hashes equivalent successful responses semantically despite a different order ID and key ordering", () => {
    const request = {
      headers: {
        "x-request-id": "semantic-success",
        "x-tenant-id": "benchmark-tenant",
        "x-trace-id": "trace-semantic-success",
      },
    };
    const workload = getWorkload("success-cpu");
    const first = semanticResponseHash(
      successResponse("semantic-success", "order-1"),
      request,
      workload,
    );
    const second = semanticResponseHash(
      successResponse("semantic-success", "order-999", true),
      request,
      workload,
    );

    expect(first.algorithm).toBe("sha256-c14n-json-v1");
    expect(first.hash).toBe(second.hash);
    expect(first.projection).toEqual(second.projection);
  });

  it("requires documented production-path provenance for every compared target", () => {
    expect(assertImplementationManifest()).toBe(
      FRAMEWORK_NATIVE_IMPLEMENTATION_MANIFEST,
    );
    expect(
      Object.keys(FRAMEWORK_NATIVE_IMPLEMENTATION_MANIFEST.targets),
    ).toEqual(["vext-native", "fastify-native", "nest-fastify"]);
    for (const target of Object.values(
      FRAMEWORK_NATIVE_IMPLEMENTATION_MANIFEST.targets,
    )) {
      expect(target.provenance.length).toBeGreaterThan(0);
      expect(
        target.provenance.every((entry) => entry.url.startsWith("https://")),
      ).toBe(true);
    }
  });

  it("keeps documentation pending until an accepted citable formal artifact exists", () => {
    expect(
      renderPending({
        labels: { title: "Formal" },
        pending: "Pending",
      } as never),
    ).toContain("<!-- framework-native-results:start -->");
    expect(() => assertArtifact({ citable: false })).toThrow("citable formal");
  });
});
