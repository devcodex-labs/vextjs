import Fastify from "fastify";
import helmet from "@fastify/helmet";
import fastifyJwt from "@fastify/jwt";
import { fastifyRequestContext } from "@fastify/request-context";
import process from "node:process";
import {
  CONTROL_PREFIX,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
  ORDER_ROUTE_PATH,
} from "../contract.mjs";
import {
  createBenchmarkRuntime,
  createDiscardLogStream,
  installOwnedProcessShutdown,
  readEffectiveCpuSet,
} from "../runtime.mjs";

const port = Number.parseInt(process.env.PORT ?? "0", 10);
const externalUrl = process.env.BENCHMARK_EXTERNAL_URL;
const runtime = createBenchmarkRuntime("fastify-native");
const app = Fastify({
  requestIdHeader: "x-request-id",
  disableRequestLogging: true,
  routerOptions: {},
  logger: { level: "info", stream: createDiscardLogStream(runtime) },
});

function isControlRequest(request) {
  return request.url.startsWith(CONTROL_PREFIX);
}

function createError(code, requestId, fields) {
  return {
    error: { code, ...(fields ? { fields } : {}) },
    meta: { requestId },
  };
}

function checksum(sku) {
  let value = 0;
  for (const character of sku)
    value = (value * 31 + character.charCodeAt(0)) % 10_007;
  return value;
}

async function quoteExternal(context, body) {
  runtime.record("externalHttp");
  const response = await fetch(`${externalUrl}/quote`, {
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
  const payload = await response.json();
  return payload.quote;
}

async function createOrder(request) {
  runtime.record("controller");
  runtime.record("service");
  await Promise.resolve();
  const context = request.requestContext.getStore();
  if (!context?.requestId || !context.tenantId || !context.traceId) {
    throw new Error(
      "Fastify request context was not propagated into the service",
    );
  }
  const body = request.body;
  const subtotal = Number((body.quantity * body.unitPrice).toFixed(2));
  const isExternal = body.sku === "SKU-EXTERNAL-001";
  const externalQuote = isExternal
    ? await quoteExternal(context, body)
    : undefined;
  const discount = isExternal ? Number((subtotal * 0.05).toFixed(2)) : 0;
  const id = runtime.allocateOrderId();
  return {
    data: {
      order: {
        id,
        userId: request.params.userId,
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
    meta: context,
  };
}

await app.register(fastifyRequestContext);
await app.register(fastifyJwt, {
  secret: process.env.BENCHMARK_JWT_SECRET ?? JWT_SECRET,
});
await app.register(helmet, {
  contentSecurityPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  frameguard: { action: "sameorigin" },
});

app.addHook("onRequest", async (request, reply) => {
  if (isControlRequest(request)) return;
  runtime.record("requestId");
  const context = {
    requestId: request.id,
    tenantId: String(request.headers["x-tenant-id"] ?? "benchmark-tenant"),
    traceId: String(request.headers["x-trace-id"] ?? `trace-${request.id}`),
  };
  request.requestContext.set("requestId", context.requestId);
  request.requestContext.set("tenantId", context.tenantId);
  request.requestContext.set("traceId", context.traceId);
  runtime.record("requestContext");
  reply.header("x-request-id", context.requestId);
});

app.addHook("preValidation", async (request, reply) => {
  if (isControlRequest(request)) return;
  runtime.record("authentication");
  try {
    await request.jwtVerify({
      allowedIss: JWT_ISSUER,
      allowedAud: JWT_AUDIENCE,
    });
  } catch {
    return reply.code(401).send(createError("AUTH_REQUIRED", request.id));
  }
  runtime.record("authorization");
  if (
    !Array.isArray(request.user?.roles) ||
    !request.user.roles.includes("orders:write")
  ) {
    return reply.code(403).send(createError("AUTH_FORBIDDEN", request.id));
  }
});

app.setErrorHandler((error, request, reply) => {
  runtime.record("errorHandler");
  if (error.validation) {
    runtime.record("validation");
    const fields = [
      ...new Set(
        error.validation.map((entry) =>
          String(entry.instancePath ?? entry.params?.missingProperty ?? "body")
            .replace(/^\//u, "")
            .replace(/^body\./u, ""),
        ),
      ),
    ].sort();
    request.log.info(
      { requestId: request.id, statusCode: 422 },
      "enterprise.request.failed",
    );
    return reply
      .code(422)
      .send(createError("VALIDATION_FAILED", request.id, fields));
  }
  request.log.error(
    { err: error, requestId: request.id },
    "enterprise.request.failed",
  );
  return reply
    .code(error.statusCode ?? 500)
    .send(createError("INTERNAL_ERROR", request.id));
});

app.get(`${CONTROL_PREFIX}/health`, async () => ({
  status: "ok",
  target: "fastify-native",
}));
app.post(`${CONTROL_PREFIX}/reset`, async () => runtime.reset());
app.get(`${CONTROL_PREFIX}/stats`, async () => runtime.snapshot());

app.post(
  ORDER_ROUTE_PATH,
  {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["userId"],
        properties: { userId: { type: "string", pattern: "^\\d+$" } },
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["sku", "quantity", "unitPrice", "currency"],
        properties: {
          sku: { type: "string", minLength: 1, maxLength: 64 },
          quantity: { type: "integer", minimum: 1 },
          unitPrice: { type: "number", exclusiveMinimum: 0 },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
        },
      },
    },
    preHandler: async () => runtime.record("validation"),
  },
  async (request, reply) => reply.code(201).send(await createOrder(request)),
);

app.addHook("onResponse", async (request, reply) => {
  if (isControlRequest(request)) return;
  request.log.info(
    { requestId: request.id, statusCode: reply.statusCode },
    "enterprise.request",
  );
});

async function start() {
  await app.listen({ host: "127.0.0.1", port });
  const address = app.server.address();
  process.send?.({
    type: "ready",
    target: "fastify-native",
    port: typeof address === "object" && address ? address.port : port,
    runtime: { fastify: app.version, cpuSet: readEffectiveCpuSet() },
  });
}

installOwnedProcessShutdown(() => app.close(), runtime);
start().catch((error) => {
  process.send?.({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exit(1);
});
