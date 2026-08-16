import { VALID_EXTERNAL_BODY, computePricingChecksum } from "./contract.mjs";

export const ORDER_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["userId"],
  properties: {
    userId: { type: "string", pattern: "^\\d+$" },
  },
});

export const ORDER_BODY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["sku", "quantity", "unitPrice", "currency"],
  properties: {
    sku: { type: "string", minLength: 1, maxLength: 64 },
    quantity: { type: "integer", minimum: 1 },
    unitPrice: { type: "number", exclusiveMinimum: 0 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
  },
});

export function createError(code, requestId, fields) {
  return {
    error: { code, ...(fields?.length ? { fields: [...fields].sort() } : {}) },
    meta: { requestId },
  };
}

export class RingOrderRepository {
  #sequence = 0;
  #slots;

  constructor({ capacity = 2048 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(
        "RingOrderRepository capacity must be a positive integer",
      );
    }
    this.#slots = new Array(capacity);
  }

  async readUser(userId) {
    return { id: String(userId), tenant: "benchmark-tenant", active: true };
  }

  async writeOrder(order) {
    const id = `order-${++this.#sequence}`;
    this.#slots[this.#sequence % this.#slots.length] = { id, ...order };
    return id;
  }
}

export class HttpQuoteClient {
  constructor({ baseUrl, timeoutMs = 5_000 }) {
    if (!baseUrl) throw new Error("HttpQuoteClient requires baseUrl");
    this.baseUrl = baseUrl.replace(/\/$/u, "");
    this.timeoutMs = timeoutMs;
  }

  async quote(context, body) {
    const response = await fetch(`${this.baseUrl}/quote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": context.requestId,
        "x-tenant-id": context.tenantId,
        "x-trace-id": context.traceId,
      },
      body: JSON.stringify({ sku: body.sku, quantity: body.quantity }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`external quote failed with HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (
      payload?.quote?.discountBasisPoints !== 500 ||
      payload?.quote?.version !== "quote-v2"
    ) {
      throw new Error("external quote violated the shared response contract");
    }
    return payload.quote;
  }
}

export class OrderService {
  constructor({ repository, quoteClient }) {
    this.repository = repository;
    this.quoteClient = quoteClient;
  }

  async create({ userId, body, context }) {
    if (!context?.requestId || !context.tenantId || !context.traceId) {
      throw new Error("request context was not propagated into OrderService");
    }
    if (body.sku === "SKU-FAIL-500") {
      throw new Error("intentional shared-contract internal error");
    }
    const user = await this.repository.readUser(userId);
    if (!user.active) throw new Error("shared-contract user is inactive");

    const subtotal = Number((body.quantity * body.unitPrice).toFixed(2));
    const isExternal = body.sku === VALID_EXTERNAL_BODY.sku;
    const externalQuote = isExternal
      ? await this.quoteClient.quote(context, body)
      : undefined;
    const discount = isExternal ? Number((subtotal * 0.05).toFixed(2)) : 0;
    const order = {
      userId: user.id,
      sku: body.sku,
      quantity: body.quantity,
      unitPrice: body.unitPrice,
      currency: body.currency,
      pricingChecksum: computePricingChecksum(body.sku),
      subtotal,
      discount,
      total: Number((subtotal - discount).toFixed(2)),
      pricingSource: isExternal ? "external-http" : "local-cpu",
      ...(isExternal ? { externalQuote } : {}),
    };
    const id = await this.repository.writeOrder(order);
    return {
      data: { order: { id, ...order } },
      meta: {
        requestId: context.requestId,
        tenantId: context.tenantId,
        traceId: context.traceId,
      },
    };
  }
}

export function normalizeValidationFields(value) {
  const fields = new Set();
  const visit = (entry) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    for (const [key, nested] of Object.entries(entry)) {
      if (key === "property" || key === "field") {
        const normalized = String(nested)
          .replace(/^\/(?:body\/)?/u, "")
          .replace(/^body\.?/u, "")
          .replace(/^.*\.(sku|quantity|unitPrice|currency|userId)$/u, "$1");
        if (normalized) fields.add(normalized);
      }
      if (key === "instancePath" && typeof nested === "string") {
        const normalized = nested.replace(/^\/(?:body\/)?/u, "");
        if (normalized) fields.add(normalized);
      }
      if (
        (key === "additionalProperty" || key === "missingProperty") &&
        typeof nested === "string"
      ) {
        const normalized = nested
          .replace(/^\/(?:body\/)?/u, "")
          .replace(/^body\.?/u, "");
        if (normalized) fields.add(normalized);
      }
      if (key === "constraints" && typeof nested === "object") {
        // class-validator exposes the class property at the current node.
        const property = String(entry.property ?? "");
        if (property) fields.add(property);
      }
      visit(nested);
    }
  };
  visit(value);
  return [...fields].sort();
}

export function accessLogPayload(request, statusCode, durationMs) {
  return {
    event: "access",
    requestId: request.id ?? request.requestId,
    method: request.method,
    path: request.routerPath ?? request.routeOptions?.url ?? request.url,
    statusCode,
    durationMs: Number(Number(durationMs ?? 0).toFixed(3)),
  };
}
