import Fastify, { LogController } from "fastify";
import {
  createErrorResponse,
  delay,
  fastifyOrderSchema,
  resolveBenchmarkIdentity,
} from "../contract.mjs";
import {
  applyEnterpriseSecurityHeaders,
  attachTenantContext,
  attachTraceContext,
  createEnterpriseState,
  createRepositoryOrder,
  createRequestContext,
  increment,
  installChildShutdown,
  readEffectiveCpuSet,
  resetEnterpriseState,
  snapshotEnterpriseState,
} from "../target-runtime.mjs";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const state = createEnterpriseState("fastify-native");

function isControlRequest(request) {
  return request.url.startsWith("/benchmark");
}

function getDelayMilliseconds(request) {
  const delayMs = Number(request.headers["x-benchmark-latency-ms"] ?? 0);
  return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0;
}

function createServices() {
  const pricing = {
    quote(body) {
      let checksum = 0;
      for (let index = 0; index < body.sku.length; index += 1) {
        checksum = (checksum * 31 + body.sku.charCodeAt(index)) % 10_007;
      }
      increment(state, "service");
      return { ...body, pricingChecksum: checksum };
    },
  };
  const repository = {
    create(input) {
      return createRepositoryOrder({ state, ...input });
    },
  };
  return {
    order: {
      async create({ userId, body, context, delayMs }) {
        increment(state, "service");
        await delay(delayMs);
        return repository.create({
          userId,
          body: pricing.quote(body),
          context,
        });
      },
    },
  };
}

const services = createServices();
const app = Fastify({
  logger: {
    level: "info",
    stream: {
      write() {
        increment(state, "structuredLog");
      },
    },
  },
  logController: new LogController({ disableRequestLogging: true }),
});

// These hooks are the direct Fastify equivalents of the request correlation
// boundary used by the Vext fixture. They are intentionally not no-ops.
app.addHook("onRequest", async (request, reply) => {
  if (isControlRequest(request)) return;
  request.enterpriseContext = createRequestContext(state, request.headers);
  reply.header("x-request-id", request.enterpriseContext.requestId);
});
app.addHook("onRequest", async (request) => {
  if (isControlRequest(request)) return;
  attachTenantContext(state, request.enterpriseContext, request.headers);
});
app.addHook("onRequest", async (request) => {
  if (isControlRequest(request)) return;
  attachTraceContext(state, request.enterpriseContext, request.headers);
});
app.addHook("onRequest", async (request, reply) => {
  if (isControlRequest(request)) return;
  increment(state, "authentication");
  const identity = resolveBenchmarkIdentity(request.headers.authorization, {
    onAuthorization: () => increment(state, "authorization"),
  });
  if (!identity) {
    return reply
      .code(401)
      .send(
        createErrorResponse(
          401,
          "AUTH_REQUIRED",
          request.enterpriseContext.requestId,
        ),
      );
  }
  request.enterpriseIdentity = identity;
});
app.addHook("preValidation", async (request, reply) => {
  if (isControlRequest(request)) return;
  if (!request.enterpriseIdentity.can("orders:create")) {
    return reply
      .code(403)
      .send(
        createErrorResponse(
          403,
          "AUTH_FORBIDDEN",
          request.enterpriseContext.requestId,
        ),
      );
  }
});
app.addHook("preHandler", async (request) => {
  if (!isControlRequest(request)) increment(state, "validation");
});
app.addHook("onSend", async (request, reply, payload) => {
  if (!isControlRequest(request)) {
    applyEnterpriseSecurityHeaders(reply.header.bind(reply));
  }
  return payload;
});
app.addHook("onResponse", async (request, reply) => {
  if (!isControlRequest(request)) {
    request.log.info(
      {
        requestId: request.enterpriseContext?.requestId,
        statusCode: reply.statusCode,
      },
      "enterprise.request",
    );
  }
});

app.setErrorHandler((error, request, reply) => {
  increment(state, "errorHandler");
  if (error.validation) {
    increment(state, "validation");
    return reply.code(422).send(
      createErrorResponse(
        422,
        422,
        request.enterpriseContext?.requestId,
        error.validation.map((entry) => ({
          field: entry.instancePath || entry.params?.missingProperty || "body",
          message: entry.message ?? "Validation failed",
        })),
      ),
    );
  }
  return reply.code(error.statusCode ?? 500).send({
    code: error.code ?? "INTERNAL_ERROR",
    message: error.message,
    requestId: request.enterpriseContext?.requestId,
  });
});

app.get("/benchmark/health", async () => ({
  status: "ok",
  target: "fastify-native",
}));
app.post("/benchmark/reset", async () => resetEnterpriseState(state));
app.get("/benchmark/stats", async () => snapshotEnterpriseState(state));

app.post(
  "/api/users/:userId/orders",
  { schema: fastifyOrderSchema() },
  async (request, reply) => {
    increment(state, "controller");
    const result = await services.order.create({
      userId: request.params.userId,
      body: request.body,
      context: request.enterpriseContext,
      delayMs: getDelayMilliseconds(request),
    });
    return reply.code(201).send(result);
  },
);

async function start() {
  await app.listen({ port, host: "127.0.0.1" });
  const address = app.server.address();
  process.send?.({
    type: "ready",
    target: "fastify-native",
    port: typeof address === "object" && address ? address.port : port,
    runtime: { fastify: app.version, cpuSet: readEffectiveCpuSet() },
  });
}

installChildShutdown({ close: () => app.close(), state });
start().catch((error) => {
  process.send?.({ type: "error", message: error.message });
  console.error(error);
  process.exit(1);
});
