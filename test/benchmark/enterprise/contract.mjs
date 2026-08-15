/**
 * Shared, implementation-neutral contract for the Enterprise Workload Suite.
 *
 * The suite compares Vext Native, direct Fastify, and Nest running on the
 * same Fastify host. It deliberately shares business semantics, not request
 * pipelines: each target uses its framework's normal validation, auth, and
 * service-composition mechanisms.
 */

export const ENTERPRISE_SUITE_ID = "vext-enterprise-workload-suite";
export const ENTERPRISE_SUITE_VERSION = 1;
export const ENTERPRISE_CONTROL_PREFIX = "/benchmark";
export const ENTERPRISE_ORDER_PATH = "/api/users/10001/orders";
export const ENTERPRISE_ORDER_ROUTE = "/api/users/:userId/orders";
export const VALID_TOKEN = "bench-valid-token";
export const FORBIDDEN_TOKEN = "bench-forbidden-token";

export const ENTERPRISE_TARGETS = Object.freeze([
  {
    id: "vext-native",
    title: "Vext Native",
    runtime: "Vext formal bootstrap with the Native adapter",
  },
  {
    id: "fastify-native",
    title: "Fastify",
    runtime: "Direct Fastify application",
  },
  {
    id: "nest-fastify",
    title: "Nest + Fastify",
    runtime: "Nest application hosted by the same Fastify version",
  },
]);

export const ENTERPRISE_SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
});

export const VALID_ORDER_BODY = Object.freeze({
  sku: "SKU-ENTERPRISE-001",
  quantity: 2,
  unitPrice: 19.5,
  currency: "USD",
});

export const INVALID_ORDER_BODY = Object.freeze({
  sku: "",
  quantity: 0,
  unitPrice: -1,
  currency: "US",
});

export const ENTERPRISE_WORKLOADS = Object.freeze([
  {
    id: "success-cpu",
    title: "Success: CPU-bound service composition",
    expectedStatus: 201,
    delayMs: 0,
    body: VALID_ORDER_BODY,
    description:
      "Valid POST through request context, auth, validation, service composition, logging, and repository write.",
  },
  {
    id: "success-latency-1ms",
    title: "Success: 1 ms deterministic latency injection",
    expectedStatus: 201,
    delayMs: 1,
    body: VALID_ORDER_BODY,
    description:
      "Same success path with a non-blocking, deterministic 1 ms latency injection.",
  },
  {
    id: "success-latency-5ms",
    title: "Success: 5 ms deterministic latency injection",
    expectedStatus: 201,
    delayMs: 5,
    body: VALID_ORDER_BODY,
    description:
      "Same success path with a non-blocking, deterministic 5 ms latency injection.",
  },
  {
    id: "validation-failure",
    title: "Failure: invalid request body",
    expectedStatus: 422,
    delayMs: 0,
    body: INVALID_ORDER_BODY,
    description:
      "Authenticated request rejected by each target's normal validation path before a repository write.",
  },
]);

export function getHeader(headers, name) {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === expected) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

export function createRequestId(seed = "request") {
  return `${seed}-${process.pid}-${Date.now().toString(36)}`;
}

export function createWorkloadRequest(workload, requestId = createRequestId()) {
  return {
    method: "POST",
    path: ENTERPRISE_ORDER_PATH,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${VALID_TOKEN}`,
      "x-request-id": requestId,
      "x-tenant-id": "benchmark-tenant",
      "x-trace-id": `trace-${requestId}`,
      ...(workload.delayMs > 0
        ? { "x-benchmark-latency-ms": String(workload.delayMs) }
        : {}),
    },
    body: { ...workload.body },
  };
}

export function createFailureRequest(kind, requestId = createRequestId(kind)) {
  const request = createWorkloadRequest(ENTERPRISE_WORKLOADS[0], requestId);
  if (kind === "missing-auth") {
    delete request.headers.authorization;
  } else if (kind === "forbidden") {
    request.headers.authorization = `Bearer ${FORBIDDEN_TOKEN}`;
  } else if (kind === "invalid-body") {
    request.body = { ...INVALID_ORDER_BODY };
  } else if (kind === "wrong-content-type") {
    request.headers["content-type"] = "text/plain";
  } else if (kind === "wrong-method") {
    request.method = "GET";
  } else {
    throw new Error(`Unknown enterprise failure request: ${kind}`);
  }
  return request;
}

export function readBearerToken(authorization) {
  if (typeof authorization !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/iu.exec(authorization.trim());
  return match?.[1];
}

export function resolveBenchmarkIdentity(
  authorization,
  { onAuthorization } = {},
) {
  const token = readBearerToken(authorization);
  const canCreateOrders = (action) => {
    onAuthorization?.();
    return token === VALID_TOKEN && action === "orders:create";
  };
  if (token === VALID_TOKEN) {
    return {
      subject: "enterprise-benchmark-user",
      userId: "10001",
      roles: ["order-writer"],
      claims: { tenantId: "benchmark-tenant" },
      can: canCreateOrders,
    };
  }
  if (token === FORBIDDEN_TOKEN) {
    return {
      subject: "enterprise-benchmark-forbidden-user",
      userId: "10002",
      roles: ["reader"],
      claims: { tenantId: "benchmark-tenant" },
      can: canCreateOrders,
    };
  }
  return null;
}

export function validateOrderInput({ userId, body }) {
  const errors = [];
  if (!/^\d+$/u.test(String(userId ?? ""))) {
    errors.push({ field: "userId", message: "must be a positive integer" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [{ field: "body", message: "must be an object" }];
  }
  if (typeof body.sku !== "string" || body.sku.trim().length < 1) {
    errors.push({ field: "sku", message: "must be a non-empty string" });
  }
  if (!Number.isInteger(body.quantity) || body.quantity < 1) {
    errors.push({ field: "quantity", message: "must be an integer >= 1" });
  }
  if (typeof body.unitPrice !== "number" || body.unitPrice <= 0) {
    errors.push({ field: "unitPrice", message: "must be a number > 0" });
  }
  if (!/^[A-Z]{3}$/u.test(String(body.currency ?? ""))) {
    errors.push({
      field: "currency",
      message: "must be an uppercase ISO code",
    });
  }
  return errors;
}

export function createOrderResponse({ id, userId, body, context }) {
  const total = Number((body.quantity * body.unitPrice).toFixed(2));
  return {
    data: {
      order: {
        id,
        userId: String(userId),
        sku: body.sku,
        quantity: body.quantity,
        unitPrice: body.unitPrice,
        currency: body.currency,
        total,
        status: "accepted",
      },
    },
    meta: {
      requestId: context.requestId,
      tenantId: context.tenantId,
      traceId: context.traceId,
    },
  };
}

export function createErrorResponse(status, code, requestId, errors) {
  return {
    code,
    message:
      status === 401
        ? "Authentication required"
        : status === 403
          ? "Forbidden"
          : "Validation failed",
    ...(errors ? { errors } : {}),
    requestId,
  };
}

export function fastifyOrderSchema() {
  return {
    params: {
      type: "object",
      required: ["userId"],
      additionalProperties: false,
      properties: { userId: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
      type: "object",
      required: ["sku", "quantity", "unitPrice", "currency"],
      additionalProperties: false,
      properties: {
        sku: { type: "string", minLength: 1 },
        quantity: { type: "integer", minimum: 1 },
        unitPrice: { type: "number", exclusiveMinimum: 0 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
      },
    },
  };
}

export function delay(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
