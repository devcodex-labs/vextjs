import "reflect-metadata";
import Fastify, { LogController } from "fastify";
import {
  Body,
  Catch,
  Controller,
  HttpCode,
  HttpException,
  Injectable,
  Module,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { tap } from "rxjs";
import {
  createErrorResponse,
  delay,
  resolveBenchmarkIdentity,
  validateOrderInput,
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
const state = createEnterpriseState("nest-fastify");

function isControlRequest(request) {
  return request.url.startsWith("/benchmark");
}

function getDelayMilliseconds(request) {
  const delayMs = Number(request.headers["x-benchmark-latency-ms"] ?? 0);
  return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0;
}

class PricingService {
  quote(body) {
    let checksum = 0;
    for (let index = 0; index < body.sku.length; index += 1) {
      checksum = (checksum * 31 + body.sku.charCodeAt(index)) % 10_007;
    }
    increment(state, "service");
    return { ...body, pricingChecksum: checksum };
  }
}
Injectable()(PricingService);

class OrderRepository {
  create(input) {
    return createRepositoryOrder({ state, ...input });
  }
}
Injectable()(OrderRepository);

class OrderService {
  constructor(repository, pricing) {
    this.repository = repository;
    this.pricing = pricing;
  }

  async create({ userId, body, context, delayMs }) {
    increment(state, "service");
    await delay(delayMs);
    return this.repository.create({
      userId,
      body: this.pricing.quote(body),
      context,
    });
  }
}
Reflect.defineMetadata(
  "design:paramtypes",
  [OrderRepository, PricingService],
  OrderService,
);
Injectable()(OrderService);

class EnterpriseGuard {
  canActivate(context) {
    const request = context.switchToHttp().getRequest();
    increment(state, "authentication");
    const identity = resolveBenchmarkIdentity(request.headers.authorization, {
      onAuthorization: () => increment(state, "authorization"),
    });
    if (!identity) {
      throw new HttpException(
        createErrorResponse(
          401,
          "AUTH_REQUIRED",
          request.enterpriseContext.requestId,
        ),
        401,
      );
    }
    request.enterpriseIdentity = identity;
    if (!identity.can("orders:create")) {
      throw new HttpException(
        createErrorResponse(
          403,
          "AUTH_FORBIDDEN",
          request.enterpriseContext.requestId,
        ),
        403,
      );
    }
    return true;
  }
}
Injectable()(EnterpriseGuard);

class EnterpriseParamPipe {
  transform(value) {
    increment(state, "validation");
    if (!/^\d+$/u.test(String(value?.userId ?? ""))) {
      throw new HttpException(
        createErrorResponse(422, 422, undefined, [
          { field: "userId", message: "must be a positive integer" },
        ]),
        422,
      );
    }
    return value;
  }
}
Injectable()(EnterpriseParamPipe);

class EnterpriseBodyPipe {
  transform(value) {
    increment(state, "validation");
    const errors = validateOrderInput({ userId: "10001", body: value });
    if (errors.length > 0) {
      throw new HttpException(
        createErrorResponse(422, 422, undefined, errors),
        422,
      );
    }
    return value;
  }
}
Injectable()(EnterpriseBodyPipe);

class EnterpriseLoggingInterceptor {
  intercept(context, next) {
    const request = context.switchToHttp().getRequest();
    return next.handle().pipe(
      tap(() => {
        request.log.info(
          {
            requestId: request.enterpriseContext.requestId,
            statusCode: 201,
          },
          "enterprise.request",
        );
      }),
    );
  }
}
Injectable()(EnterpriseLoggingInterceptor);

class EnterpriseExceptionFilter {
  catch(exception, host) {
    const context = host.switchToHttp();
    const request = context.getRequest();
    const reply = context.getResponse();
    increment(state, "errorHandler");
    const status = exception.getStatus();
    const response = exception.getResponse();
    const body =
      response && typeof response === "object"
        ? { ...response, requestId: request.enterpriseContext?.requestId }
        : createErrorResponse(
            status,
            status,
            request.enterpriseContext?.requestId,
          );
    request.log.info(
      {
        requestId: request.enterpriseContext?.requestId,
        statusCode: status,
      },
      "enterprise.request",
    );
    reply.code(status).send(body);
  }
}
Catch(HttpException)(EnterpriseExceptionFilter);

class OrderController {
  constructor(orderService) {
    this.orderService = orderService;
  }

  async create(params, body, request) {
    increment(state, "controller");
    return this.orderService.create({
      userId: params.userId,
      body,
      context: request.enterpriseContext,
      delayMs: getDelayMilliseconds(request),
    });
  }
}
Reflect.defineMetadata("design:paramtypes", [OrderService], OrderController);
Controller("api/users")(OrderController);
const createDescriptor = Object.getOwnPropertyDescriptor(
  OrderController.prototype,
  "create",
);
Post(":userId/orders")(OrderController.prototype, "create", createDescriptor);
HttpCode(201)(OrderController.prototype, "create", createDescriptor);
Param(EnterpriseParamPipe)(OrderController.prototype, "create", 0);
Body(EnterpriseBodyPipe)(OrderController.prototype, "create", 1);
Req()(OrderController.prototype, "create", 2);
UseGuards(EnterpriseGuard)(
  OrderController.prototype,
  "create",
  createDescriptor,
);
UseInterceptors(EnterpriseLoggingInterceptor)(
  OrderController.prototype,
  "create",
  createDescriptor,
);
UseFilters(EnterpriseExceptionFilter)(
  OrderController.prototype,
  "create",
  createDescriptor,
);

class EnterpriseModule {}
Module({
  providers: [
    PricingService,
    OrderRepository,
    OrderService,
    EnterpriseGuard,
    EnterpriseParamPipe,
    EnterpriseBodyPipe,
    EnterpriseLoggingInterceptor,
    EnterpriseExceptionFilter,
  ],
  controllers: [OrderController],
})(EnterpriseModule);

const raw = Fastify({
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

// Nest is hosted by the same Fastify version as the direct target. These host
// hooks establish the same request-correlation boundary before Nest Guards.
raw.addHook("onRequest", async (request, reply) => {
  if (isControlRequest(request)) return;
  request.enterpriseContext = createRequestContext(state, request.headers);
  reply.header("x-request-id", request.enterpriseContext.requestId);
});
raw.addHook("onRequest", async (request) => {
  if (isControlRequest(request)) return;
  attachTenantContext(state, request.enterpriseContext, request.headers);
});
raw.addHook("onRequest", async (request) => {
  if (isControlRequest(request)) return;
  attachTraceContext(state, request.enterpriseContext, request.headers);
});
raw.addHook("onSend", async (request, reply, payload) => {
  if (!isControlRequest(request)) {
    applyEnterpriseSecurityHeaders(reply.header.bind(reply));
  }
  return payload;
});

raw.get("/benchmark/health", async () => ({
  status: "ok",
  target: "nest-fastify",
}));
raw.post("/benchmark/reset", async () => resetEnterpriseState(state));
raw.get("/benchmark/stats", async () => snapshotEnterpriseState(state));

let application;

async function start() {
  application = await NestFactory.create(
    EnterpriseModule,
    new FastifyAdapter(raw),
    { logger: false },
  );
  await application.listen({ port, host: "127.0.0.1" });
  const address = raw.server.address();
  process.send?.({
    type: "ready",
    target: "nest-fastify",
    port: typeof address === "object" && address ? address.port : port,
    runtime: { fastify: raw.version, cpuSet: readEffectiveCpuSet() },
  });
}

installChildShutdown({ close: () => application?.close(), state });
start().catch((error) => {
  process.send?.({ type: "error", message: error.message });
  console.error(error);
  process.exit(1);
});
