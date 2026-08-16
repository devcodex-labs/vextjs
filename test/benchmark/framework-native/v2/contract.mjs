import { SignJWT } from "jose";

import { CANONICAL_JSON_VERSION, semanticHash } from "../canonical-json.mjs";

export const FRAMEWORK_NATIVE_V2_SUITE_ID =
  "framework-native-enterprise-api-windows-v2";
export const FRAMEWORK_NATIVE_V2_PROTOCOL_VERSION = 4;
export const SEMANTIC_RESPONSE_CONTRACT_VERSION = "enterprise-semantic-v2";
export const ORDER_PATH = "/api/users/10001/orders";
export const ORDER_ROUTE_PATH = "/api/users/:userId/orders";
export const JWT_ISSUER = "urn:vextjs:framework-native-benchmark";
export const JWT_AUDIENCE = "vextjs-framework-native-client";
export const JWT_ALGORITHM = "HS256";
export const JWT_SECRET = "framework-native-benchmark-secret-v2";
export const REQUIRED_SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
});

export const TARGETS = Object.freeze([
  { id: "vext-native", title: "VextJS + Native Adapter" },
  { id: "fastify", title: "Fastify" },
  { id: "nest-fastify", title: "NestJS + Fastify" },
]);

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
export const INTERNAL_ERROR_BODY = Object.freeze({
  sku: "SKU-FAIL-500",
  quantity: 2,
  unitPrice: 19.5,
  currency: "USD",
});

export const TIMED_WORKLOADS = Object.freeze([
  {
    id: "EW-01",
    slug: "enterprise-success-cpu",
    title: "Authenticated success — CPU path",
    expectedStatus: 201,
    expectedCode: "ORDER_CREATED",
    body: VALID_CPU_BODY,
    quoteDelayMs: 0,
  },
  {
    id: "EW-02",
    slug: "enterprise-success-io-20ms",
    title: "Authenticated success — nominal 20 ms HTTP quote",
    expectedStatus: 201,
    expectedCode: "ORDER_CREATED",
    body: VALID_EXTERNAL_BODY,
    quoteDelayMs: 20,
  },
  {
    id: "EW-03",
    slug: "enterprise-success-io-40ms",
    title: "Authenticated success — nominal 40 ms HTTP quote",
    expectedStatus: 201,
    expectedCode: "ORDER_CREATED",
    body: VALID_EXTERNAL_BODY,
    quoteDelayMs: 40,
  },
  {
    id: "EW-04",
    slug: "enterprise-validation-error",
    title: "Authenticated validation failure",
    expectedStatus: 422,
    expectedCode: "VALIDATION_FAILED",
    validationFields: ["quantity"],
    body: { ...VALID_CPU_BODY, quantity: 0 },
    quoteDelayMs: 0,
  },
  {
    id: "EW-05",
    slug: "enterprise-authentication-error",
    title: "Authentication failure",
    expectedStatus: 401,
    expectedCode: "AUTH_REQUIRED",
    body: VALID_CPU_BODY,
    authentication: "missing",
    quoteDelayMs: 0,
  },
  {
    id: "EW-06",
    slug: "enterprise-authorization-error",
    title: "Authorization failure",
    expectedStatus: 403,
    expectedCode: "AUTH_FORBIDDEN",
    body: VALID_CPU_BODY,
    authentication: "forbidden",
    quoteDelayMs: 0,
  },
]);

export const CONFORMANCE_ONLY_PROBES = Object.freeze([
  {
    id: "NP-01",
    slug: "method-not-allowed",
    expectedStatus: 405,
    expectedCode: "METHOD_NOT_ALLOWED",
    mutate(request) {
      request.method = "GET";
    },
  },
  {
    id: "NP-02",
    slug: "unsupported-media-type",
    expectedStatus: 415,
    expectedCode: "UNSUPPORTED_MEDIA_TYPE",
    mutate(request) {
      request.headers["content-type"] = "text/plain";
      request.body = "not-json";
    },
  },
  {
    id: "NP-03",
    slug: "internal-error",
    expectedStatus: 500,
    expectedCode: "INTERNAL_ERROR",
    mutate(request) {
      request.body = { ...INTERNAL_ERROR_BODY };
    },
  },
  {
    id: "NP-04",
    slug: "invalid-token",
    expectedStatus: 401,
    expectedCode: "AUTH_REQUIRED",
    mutate(request) {
      request.headers.authorization = "Bearer malformed.jwt.value";
    },
  },
  {
    id: "NP-05",
    slug: "unknown-field",
    expectedStatus: 422,
    expectedCode: "VALIDATION_FAILED",
    validationFields: ["unexpected"],
    mutate(request) {
      request.body = { ...VALID_CPU_BODY, unexpected: true };
    },
  },
  {
    id: "NP-06",
    slug: "decimal-coercion",
    expectedStatus: 422,
    expectedCode: "VALIDATION_FAILED",
    validationFields: ["quantity"],
    mutate(request) {
      request.body = { ...VALID_CPU_BODY, quantity: "2" };
    },
  },
]);

export function getTimedWorkload(id) {
  const workload = TIMED_WORKLOADS.find(
    (entry) => entry.id === id || entry.slug === id,
  );
  if (!workload) throw new Error(`Unknown timed workload: ${id}`);
  return workload;
}

export async function createBenchmarkTokens(
  secret = JWT_SECRET,
  { expirationSeconds = 600 } = {},
) {
  if (!Number.isInteger(expirationSeconds) || expirationSeconds <= 0) {
    throw new Error(
      "Benchmark token expirationSeconds must be a positive integer",
    );
  }
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
      .setExpirationTime(issuedAt + expirationSeconds)
      .sign(key);
  return {
    valid: await create("benchmark-order-writer", ["orders:write"]),
    forbidden: await create("benchmark-read-only", ["orders:read"]),
  };
}

export function createRequest(workload, tokens, requestId) {
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

export function createProbeRequest(probe, tokens, requestId) {
  const request = createRequest(getTimedWorkload("EW-01"), tokens, requestId);
  probe.mutate(request);
  return request;
}

export function computePricingChecksum(sku) {
  let checksum = 0;
  for (const character of sku) {
    checksum = (checksum * 31 + character.charCodeAt(0)) % 10_007;
  }
  return checksum;
}

function fail(message) {
  throw new Error(`Framework-native v2 semantic contract failure: ${message}`);
}

function getHeader(headers, name) {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === expected) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function expectedSuccessOrder(body) {
  const subtotal = Number((body.quantity * body.unitPrice).toFixed(2));
  const external = body.sku === VALID_EXTERNAL_BODY.sku;
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
      ? {
          externalQuote: {
            discountBasisPoints: 500,
            version: "quote-v2",
            sku: body.sku,
          },
        }
      : {}),
  };
}

function responseCorrelation(response, request) {
  const contentType = String(getHeader(response.headers, "content-type") ?? "")
    .split(";", 1)[0]
    .toLowerCase();
  if (contentType !== "application/json") {
    fail(`expected application/json, received ${contentType || "missing"}`);
  }
  for (const [name, expected] of Object.entries(REQUIRED_SECURITY_HEADERS)) {
    if (getHeader(response.headers, name) !== expected) {
      fail(`missing required security header ${name}=${expected}`);
    }
  }
  const requestId = request.headers["x-request-id"];
  if (getHeader(response.headers, "x-request-id") !== requestId) {
    fail("x-request-id response header does not correlate to the request");
  }
  const bodyRequestId =
    response.body?.meta?.requestId ??
    response.body?.requestId ??
    response.body?.error?.requestId;
  if (bodyRequestId !== requestId) {
    fail("response body requestId does not correlate to the request");
  }
  return {
    requestId,
    tenantId: request.headers["x-tenant-id"],
    traceId: request.headers["x-trace-id"],
    contentType,
  };
}

function canonicalErrorCode(response, expectedCode) {
  const rawCode = response.body?.error?.code ?? response.body?.code;
  if (rawCode === expectedCode) return rawCode;

  // Vext's documented default error envelope uses numeric HTTP codes for
  // generic validation/internal failures and AUTH_INVALID for malformed
  // credentials. These are semantically equivalent to the suite's stable
  // cross-framework codes; canonicalization intentionally does not demand
  // byte-identical framework envelopes.
  if (rawCode === response.status && response.status === 422) {
    return "VALIDATION_FAILED";
  }
  if (rawCode === response.status && response.status === 500) {
    return "INTERNAL_ERROR";
  }
  if (rawCode === "AUTH_INVALID" && response.status === 401) {
    return "AUTH_REQUIRED";
  }
  return undefined;
}

function validationFieldsFromResponse(response) {
  const fields = new Set();
  const addField = (value) => {
    if (typeof value !== "string") return;
    const normalized = value
      .replace(/^\/(?:body\/)?/u, "")
      .replace(/^body\.?/u, "");
    if (normalized) fields.add(normalized);
  };
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (
        (key === "field" ||
          key === "property" ||
          key === "additionalProperty") &&
        typeof nested === "string"
      ) {
        addField(nested);
      }
      if (key === "instancePath" && typeof nested === "string") {
        const normalized = nested.replace(/^\/(?:body\/)?/u, "");
        if (normalized) fields.add(normalized);
      }
      visit(nested);
    }
  };
  const declaredFields = response.body?.error?.fields;
  if (Array.isArray(declaredFields)) {
    declaredFields.forEach((entry) => {
      if (typeof entry === "string") addField(entry);
      else visit(entry);
    });
  } else {
    visit(declaredFields);
  }
  visit(response.body?.errors);
  visit(response.body?.error?.errors);
  return [...fields].sort();
}

function expectedFromInput(input) {
  if (input.expectedStatus) return input;
  return {
    expectedStatus: input.expectedStatus,
    expectedCode: input.expectedCode,
  };
}

/**
 * Produces a versioned semantic projection. It deliberately excludes dynamic
 * order IDs, JSON key order and raw byte serialization from the hash.
 */
export function projectSemanticResponse(response, request, expectation) {
  const expected = expectedFromInput(expectation);
  const correlation = responseCorrelation(response, request);
  if (response.status !== expected.expectedStatus) {
    fail(
      `expected HTTP ${expected.expectedStatus}, received ${response.status}`,
    );
  }
  const code =
    response.status === 201
      ? "ORDER_CREATED"
      : canonicalErrorCode(response, expected.expectedCode);
  if (code !== expected.expectedCode) {
    fail(
      `expected error/outcome code ${expected.expectedCode}, received ${String(code)}`,
    );
  }
  const projection = {
    version: SEMANTIC_RESPONSE_CONTRACT_VERSION,
    status: response.status,
    contentType: correlation.contentType,
    securityHeaders: REQUIRED_SECURITY_HEADERS,
    correlation: {
      // The values themselves are request-scoped and intentionally vary for
      // every load request. responseCorrelation() has already proved that
      // each value echoed the corresponding request header; the canonical
      // semantic hash records that invariant rather than hashing volatile
      // request IDs or trace IDs.
      requestId: "matches-request-header",
      tenantId: "matches-request-header",
      traceId: "matches-request-header",
    },
    code,
  };
  if (response.status !== 201) {
    if (!response.body || typeof response.body !== "object") {
      fail("error response does not contain a JSON error envelope");
    }
    if (response.status !== 422) return { ...projection, error: {} };
    const actualFields = validationFieldsFromResponse(response);
    const expectedFields = [...(expected.validationFields ?? [])].sort();
    if (expectedFields.length === 0) {
      fail("validation expectation does not declare rejected fields");
    }
    if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) {
      fail(
        `expected rejected fields ${JSON.stringify(expectedFields)}, received ${JSON.stringify(actualFields)}`,
      );
    }
    return { ...projection, error: { fields: actualFields } };
  }

  const order = response.body?.data?.order;
  const expectedOrder = expectedSuccessOrder(request.body);
  if (
    !order ||
    typeof order.id !== "string" ||
    !/^order-\d+$/u.test(order.id)
  ) {
    fail("success response does not contain an order ID");
  }
  for (const [key, value] of Object.entries(expectedOrder)) {
    if (JSON.stringify(order[key]) !== JSON.stringify(value)) {
      fail(`success response order.${key} differs from the shared contract`);
    }
  }
  if (
    response.body?.meta?.tenantId !== correlation.tenantId ||
    response.body?.meta?.traceId !== correlation.traceId
  ) {
    fail("success response lost tenant or trace correlation");
  }
  return { ...projection, outcome: expectedOrder };
}

export function semanticResponseHash(response, request, expectation) {
  const projection = projectSemanticResponse(response, request, expectation);
  return {
    algorithm: `sha256-${CANONICAL_JSON_VERSION}`,
    projection,
    hash: semanticHash(projection),
  };
}

export function expectedSideEffects(expectation) {
  return expectation.expectedStatus === 201
    ? { reads: 1, writes: 1, quoteCalls: expectation.quoteDelayMs > 0 ? 1 : 0 }
    : { reads: 0, writes: 0, quoteCalls: 0 };
}
