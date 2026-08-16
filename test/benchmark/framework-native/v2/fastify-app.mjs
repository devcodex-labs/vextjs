import helmet from "@fastify/helmet";
import fastifyJwt from "@fastify/jwt";
import { fastifyRequestContext } from "@fastify/request-context";
import Fastify, { LogController } from "fastify";

import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
  ORDER_PATH,
  ORDER_ROUTE_PATH,
} from "./contract.mjs";
import {
  ORDER_BODY_SCHEMA,
  ORDER_PARAMS_SCHEMA,
  OrderService,
  accessLogPayload,
  createError,
  normalizeValidationFields,
} from "./application-model.mjs";

function isOrderPath(url) {
  return String(url).split("?", 1)[0] === ORDER_PATH;
}

function contentType(request) {
  return String(request.headers["content-type"] ?? "")
    .split(";", 1)[0]
    .toLowerCase();
}

function errorCode(error) {
  if (
    error?.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ||
    error?.statusCode === 415
  ) {
    return { statusCode: 415, code: "UNSUPPORTED_MEDIA_TYPE" };
  }
  if (error?.validation) {
    return { statusCode: 422, code: "VALIDATION_FAILED" };
  }
  return {
    statusCode: Number(error?.statusCode) || 500,
    code: "INTERNAL_ERROR",
  };
}

/**
 * Direct Fastify's documented composition path: plugins own decoration,
 * request-context, authentication, validation, service and repository setup.
 * It contains no conformance observer or benchmark telemetry branch.
 */
export async function createFastifyApp({ repository, quoteClient, logStream }) {
  const app = Fastify({
    requestIdHeader: "x-request-id",
    ajv: {
      customOptions: { coerceTypes: false, removeAdditional: false },
    },
    logController: new LogController({ disableRequestLogging: true }),
    logger: { level: "info", stream: logStream },
  });

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
    reply.header("x-request-id", request.id);
    if (isOrderPath(request.url) && request.method !== "POST") {
      return reply
        .code(405)
        .send(createError("METHOD_NOT_ALLOWED", request.id));
    }
    if (
      isOrderPath(request.url) &&
      contentType(request) !== "application/json"
    ) {
      return reply
        .code(415)
        .send(createError("UNSUPPORTED_MEDIA_TYPE", request.id));
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const { statusCode, code } = errorCode(error);
    if (statusCode >= 500) {
      request.log.error(
        { err: error, requestId: request.id },
        "enterprise.error",
      );
    }
    const fields =
      code === "VALIDATION_FAILED"
        ? normalizeValidationFields(error.validation ?? error)
        : undefined;
    return reply.code(statusCode).send(createError(code, request.id, fields));
  });

  await app.register(async function enterpriseOrderApi(instance) {
    instance.decorate("orderRepository", repository);
    instance.decorate(
      "orderService",
      new OrderService({
        repository: instance.orderRepository,
        quoteClient,
      }),
    );

    instance.addHook("onRequest", async (request) => {
      const context = {
        requestId: request.id,
        tenantId: String(request.headers["x-tenant-id"] ?? "benchmark-tenant"),
        traceId: String(request.headers["x-trace-id"] ?? `trace-${request.id}`),
      };
      request.requestContext.set("requestId", context.requestId);
      request.requestContext.set("tenantId", context.tenantId);
      request.requestContext.set("traceId", context.traceId);
    });

    instance.addHook("preValidation", async (request, reply) => {
      try {
        await request.jwtVerify({
          allowedIss: JWT_ISSUER,
          allowedAud: JWT_AUDIENCE,
        });
      } catch {
        return reply.code(401).send(createError("AUTH_REQUIRED", request.id));
      }
      if (
        !Array.isArray(request.user?.roles) ||
        !request.user.roles.includes("orders:write")
      ) {
        return reply.code(403).send(createError("AUTH_FORBIDDEN", request.id));
      }
    });

    instance.post(
      ORDER_ROUTE_PATH,
      {
        schema: {
          params: ORDER_PARAMS_SCHEMA,
          body: ORDER_BODY_SCHEMA,
        },
      },
      async (request, reply) => {
        const service = request.server.orderService;
        return reply.code(201).send(
          await service.create({
            userId: request.params.userId,
            body: request.body,
            context: request.requestContext.getStore(),
          }),
        );
      },
    );
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      accessLogPayload(request, reply.statusCode, reply.elapsedTime),
      "enterprise.access",
    );
  });

  return app;
}
