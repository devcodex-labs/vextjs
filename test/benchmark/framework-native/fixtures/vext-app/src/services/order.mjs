import { requestContext } from "vextjs";
import { benchmarkRuntime } from "../plugins/benchmark-runtime.mjs";

function checksum(sku) {
  let value = 0;
  for (const character of sku)
    value = (value * 31 + character.charCodeAt(0)) % 10_007;
  return value;
}

async function quoteExternal(context, body) {
  benchmarkRuntime.record("externalHttp");
  const response = await fetch(`${process.env.BENCHMARK_EXTERNAL_URL}/quote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": context.requestId,
      "x-tenant-id": context.tenantId,
      "x-trace-id": context.traceId,
    },
    body: JSON.stringify({ sku: body.sku, quantity: body.quantity }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    throw new Error(`external quote failed with ${response.status}`);
  return (await response.json()).quote;
}

export default class OrderService {
  async create({ userId, body }) {
    benchmarkRuntime.record("service");
    await Promise.resolve();
    const context = requestContext.getStore();
    if (!context?.requestId || !context.tenantId || !context.traceId) {
      throw new Error(
        "Vext requestContext was not propagated into OrderService",
      );
    }
    const subtotal = Number((body.quantity * body.unitPrice).toFixed(2));
    const isExternal = body.sku === "SKU-EXTERNAL-001";
    const externalQuote = isExternal
      ? await quoteExternal(context, body)
      : undefined;
    const discount = isExternal ? Number((subtotal * 0.05).toFixed(2)) : 0;
    const id = benchmarkRuntime.allocateOrderId();
    return {
      data: {
        order: {
          id,
          userId: String(userId),
          sku: body.sku,
          quantity: body.quantity,
          unitPrice: body.unitPrice,
          currency: body.currency,
          pricingChecksum: checksum(body.sku),
          subtotal,
          discount,
          total: Number((subtotal - discount).toFixed(2)),
          pricingSource: isExternal ? "external-http" : "local-cpu",
          ...(isExternal ? { externalQuote } : {}),
        },
      },
      meta: {
        requestId: context.requestId,
        tenantId: context.tenantId,
        traceId: context.traceId,
      },
    };
  }
}
