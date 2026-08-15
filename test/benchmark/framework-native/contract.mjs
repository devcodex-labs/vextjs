import { SignJWT } from "jose";
import { CANONICAL_JSON_VERSION, semanticHash } from "./canonical-json.mjs";

export const FRAMEWORK_NATIVE_SUITE_ID =
  "framework-native-product-stack-enterprise-api";
export const FRAMEWORK_NATIVE_SUITE_VERSION = 1;
export const SEMANTIC_RESPONSE_CONTRACT_VERSION = "semantic-response-v1";
// Vext derives the route-file prefix from `src/routes/benchmark.mjs`, so the
// owned control plane intentionally lives at `/benchmark` for every target.
// It is not part of the public workload contract.
export const CONTROL_PREFIX = "/benchmark";
export const ORDER_PATH = "/api/users/10001/orders";
export const ORDER_ROUTE_PATH = "/api/users/:userId/orders";
export const JWT_ISSUER = "urn:vextjs:framework-native-benchmark";
export const JWT_AUDIENCE = "vextjs-framework-native-client";
export const JWT_ALGORITHM = "HS256";
export const JWT_SECRET = "framework-native-benchmark-secret-v1";
export const REQUIRED_SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
});

export const VALID_CPU_BODY = Object.freeze({
  sku: "SKU-CPU-001",
  quantity: 2,
  unitPrice: 19.5,
  currency: "USD",
});
export const VALID_EXTERNAL_BODY = Object.freeze({
  sku: "SKU-EXTERNAL-001",
  quantity: 2,
  unitPrice: 19.5,
  currency: "USD",
});
export const INVALID_BODY = Object.freeze({
  ...VALID_CPU_BODY,
  quantity: 0,
});

export const FRAMEWORK_NATIVE_TARGETS = Object.freeze([
  { id: "vext-native", title: "VextJS + Native Adapter" },
  { id: "fastify-native", title: "Fastify" },
  { id: "nest-fastify", title: "NestJS + Fastify" },
]);

export const FRAMEWORK_NATIVE_WORKLOADS = Object.freeze([
  {
    id: "success-cpu",
    title: "Success: authenticated CPU service path",
    expectedStatus: 201,
    outcome: "order-created",
    body: VALID_CPU_BODY,
    description:
      "JWT verification, authorization, ALS context, validation, service composition, one repository write, security headers, and structured discard logging.",
  },
  {
    id: "success-external-http",
    title: "Success: controlled external HTTP quote",
    expectedStatus: 201,
    outcome: "order-created-external-http",
    body: VALID_EXTERNAL_BODY,
    description:
      "The same application path plus one real TCP/HTTP quote request to an owned local sidecar. It is not a database or Redis substitute.",
  },
  {
    id: "validation-422",
    title: "Failure: validation",
    expectedStatus: 422,
    outcome: "validation-failed",
    body: INVALID_BODY,
    description:
      "Authenticated request rejected by each framework's normal validator before a repository write.",
  },
  {
    id: "authentication-401",
    title: "Failure: authentication",
    expectedStatus: 401,
    outcome: "auth-required",
    body: VALID_CPU_BODY,
    authentication: "missing",
    description:
      "Missing JWT rejected by each framework's own authentication path before a repository write.",
  },
  {
    id: "authorization-403",
    title: "Failure: authorization",
    expectedStatus: 403,
    outcome: "auth-forbidden",
    body: VALID_CPU_BODY,
    authentication: "forbidden",
    description:
      "Valid JWT without the order-write role rejected by each framework's own authorization path before a repository write.",
  },
]);

export function getWorkload(workloadId) {
  const workload = FRAMEWORK_NATIVE_WORKLOADS.find(
    (entry) => entry.id === workloadId,
  );
  if (!workload)
    throw new Error(`Unknown framework-native workload: ${workloadId}`);
  return workload;
}

export async function createBenchmarkTokens(secret = JWT_SECRET) {
  const key = new TextEncoder().encode(secret);
  const issuedAt = Math.floor(Date.now() / 1000);
  const create = (subject, roles) =>
    new SignJWT({
      roles,
      tenantId: "benchmark-tenant",
      tracePolicy: "propagate",
    })
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setSubject(subject)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 600)
      .sign(key);
  return {
    valid: await create("benchmark-order-writer", ["orders:write"]),
    forbidden: await create("benchmark-read-only", ["orders:read"]),
  };
}

export function createWorkloadRequest(workload, tokens, requestId) {
  const authentication = workload.authentication ?? "valid";
  const authorization =
    authentication === "missing"
      ? undefined
      : `Bearer ${authentication === "forbidden" ? tokens.forbidden : tokens.valid}`;
  return {
    method: "POST",
    path: ORDER_PATH,
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
      "x-request-id": requestId,
      "x-tenant-id": "benchmark-tenant",
      "x-trace-id": `trace-${requestId}`,
    },
    body: { ...workload.body },
  };
}

export function createNegativeProbe(kind, tokens, requestId) {
  const request = createWorkloadRequest(
    getWorkload("success-cpu"),
    tokens,
    requestId,
  );
  if (kind === "wrong-method") {
    request.method = "GET";
  } else if (kind === "wrong-content-type") {
    request.headers["content-type"] = "text/plain";
  } else if (kind === "invalid-token") {
    request.headers.authorization = "Bearer malformed.jwt.value";
  } else {
    throw new Error(`Unknown negative probe: ${kind}`);
  }
  return request;
}

export function computePricingChecksum(sku) {
  let checksum = 0;
  for (const character of sku) {
    checksum = (checksum * 31 + character.charCodeAt(0)) % 10_007;
  }
  return checksum;
}

function expectedSuccessOrder(workload) {
  const body = workload.body;
  const subtotal = Number((body.quantity * body.unitPrice).toFixed(2));
  const external = workload.id === "success-external-http";
  const discount = external ? Number((subtotal * 0.05).toFixed(2)) : 0;
  return {
    userId: "10001",
    sku: body.sku,
    quantity: body.quantity,
    unitPrice: body.unitPrice,
    currency: body.currency,
    pricingChecksum: computePricingChecksum(body.sku),
    subtotal,
    discount,
    total: Number((subtotal - discount).toFixed(2)),
    pricingSource: external ? "external-http" : "local-cpu",
    ...(external
      ? { externalQuote: { discountBasisPoints: 500, version: "quote-v1" } }
      : {}),
  };
}

function fail(message) {
  throw new Error(`Framework-native semantic contract failure: ${message}`);
}

function getHeader(headers, name) {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === expected)
      return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function assertResponseEnvelope(response, request) {
  const mediaType = String(getHeader(response.headers, "content-type") ?? "")
    .split(";", 1)[0]
    .toLowerCase();
  if (mediaType !== "application/json") {
    fail(
      `expected application/json, received ${mediaType || "missing content-type"}`,
    );
  }
  for (const [name, expected] of Object.entries(REQUIRED_SECURITY_HEADERS)) {
    if (getHeader(response.headers, name) !== expected) {
      fail(`missing required security header ${name}=${expected}`);
    }
  }
  const responseRequestId =
    response.body?.meta?.requestId ??
    response.body?.requestId ??
    response.body?.error?.requestId;
  if (responseRequestId !== request.headers["x-request-id"]) {
    fail(`request ID correlation mismatch: ${JSON.stringify(response.body)}`);
  }
  return mediaType;
}

function normalizeField(value) {
  return String(value ?? "")
    .replace(/^\/(?:body\/)?/u, "")
    .replace(/^(?:body\.)/u, "")
    .replace(/^.*\.(sku|quantity|unitPrice|currency)$/u, "$1");
}

function extractValidationFields(value, fields = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) extractValidationFields(entry, fields);
    return fields;
  }
  if (!value || typeof value !== "object") return fields;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "fields" && Array.isArray(entry)) {
      for (const field of entry) {
        if (typeof field === "string") {
          const normalized = normalizeField(field);
          if (normalized) fields.add(normalized);
        }
      }
    }
    if (
      ["field", "property", "instancePath", "path"].includes(key) &&
      typeof entry === "string"
    ) {
      const normalized = normalizeField(entry);
      if (normalized) fields.add(normalized);
    }
    extractValidationFields(entry, fields);
  }
  return fields;
}

function normalizedErrorCode(response, workload) {
  const raw = JSON.stringify(response.body ?? {}).toUpperCase();
  if (workload.outcome === "auth-required") {
    if (
      !raw.includes("AUTH") &&
      !raw.includes("UNAUTHORIZED") &&
      !raw.includes("401")
    ) {
      fail("401 response does not expose authentication semantics");
    }
    return "AUTH_REQUIRED";
  }
  if (workload.outcome === "auth-forbidden") {
    if (!raw.includes("FORBIDDEN") && !raw.includes("403")) {
      fail("403 response does not expose authorization semantics");
    }
    return "AUTH_FORBIDDEN";
  }
  if (!raw.includes("VALID") && !raw.includes("422")) {
    fail("422 response does not expose validation semantics");
  }
  return "VALIDATION_FAILED";
}

/**
 * Project a raw HTTP response into the versioned semantic contract. This is
 * intentionally stricter than status-only checking but deliberately does not
 * hash raw serialized bytes, JSON whitespace, or object-key ordering.
 */
export function projectSemanticResponse(response, request, workload) {
  const mediaType = assertResponseEnvelope(response, request);
  if (response.status !== workload.expectedStatus) {
    fail(
      `${workload.id} expected status ${workload.expectedStatus}, received ${response.status}`,
    );
  }
  const correlation = {
    requestId: request.headers["x-request-id"],
    tenantId: request.headers["x-tenant-id"],
    traceId: request.headers["x-trace-id"],
  };
  const envelope = {
    version: SEMANTIC_RESPONSE_CONTRACT_VERSION,
    status: response.status,
    contentType: mediaType,
    securityHeaders: REQUIRED_SECURITY_HEADERS,
    correlation,
  };
  if (workload.expectedStatus === 201) {
    const order = response.body?.data?.order;
    const meta = response.body?.meta;
    const expected = expectedSuccessOrder(workload);
    if (
      !order ||
      !meta ||
      meta.tenantId !== correlation.tenantId ||
      meta.traceId !== correlation.traceId
    ) {
      fail(
        `success response lost correlation fields: ${JSON.stringify(response.body)}`,
      );
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (JSON.stringify(order[key]) !== JSON.stringify(expectedValue)) {
        fail(`success order ${key} mismatch`);
      }
    }
    if (typeof order.id !== "string" || !/^order-\d+$/u.test(order.id)) {
      fail("success response has no deterministic repository order ID");
    }
    return { ...envelope, outcome: workload.outcome, order: expected };
  }
  const code = normalizedErrorCode(response, workload);
  const fields = [...extractValidationFields(response.body)].sort();
  if (
    workload.outcome === "validation-failed" &&
    !fields.includes("quantity")
  ) {
    fail(
      `validation response did not expose rejected field quantity: ${JSON.stringify(response.body)}`,
    );
  }
  return {
    ...envelope,
    outcome: workload.outcome,
    error: { code, ...(fields.length > 0 ? { fields } : {}) },
  };
}

export function semanticResponseHash(response, request, workload) {
  const projection = projectSemanticResponse(response, request, workload);
  return {
    algorithm: `sha256-${CANONICAL_JSON_VERSION}`,
    projection,
    hash: semanticHash(projection),
  };
}
