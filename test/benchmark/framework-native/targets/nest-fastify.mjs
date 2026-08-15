import "reflect-metadata";
import { AsyncLocalStorage } from "node:async_hooks";
import process from "node:process";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import {
  Body,
  Catch,
  Controller,
  ForbiddenException,
  HttpException,
  Injectable,
  Module,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { JwtModule, JwtService } from "@nestjs/jwt";
import {
  IsInt,
  IsNumber,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { tap } from "rxjs";
import {
  CONTROL_PREFIX,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
} from "../contract.mjs";
import {
  createBenchmarkRuntime,
  createDiscardLogStream,
  installOwnedProcessShutdown,
  readEffectiveCpuSet,
} from "../runtime.mjs";

const port = Number.parseInt(process.env.PORT ?? "0", 10);
const externalUrl = process.env.BENCHMARK_EXTERNAL_URL;
const requestStore = new AsyncLocalStorage();
const runtime = createBenchmarkRuntime("nest-fastify");

function isControlRequest(request) {
  return request.url.startsWith(CONTROL_PREFIX);
}

function checksum(sku) {
  let value = 0;
  for (const character of sku)
    value = (value * 31 + character.charCodeAt(0)) % 10_007;
  return value;
}

function createError(code, requestId, fields) {
  return {
    error: { code, ...(fields ? { fields } : {}) },
    meta: { requestId },
  };
}

class CreateOrderDto {}
IsString()(CreateOrderDto.prototype, "sku");
MinLength(1)(CreateOrderDto.prototype, "sku");
MaxLength(64)(CreateOrderDto.prototype, "sku");
IsInt()(CreateOrderDto.prototype, "quantity");
Min(1)(CreateOrderDto.prototype, "quantity");
IsNumber({ allowNaN: false, allowInfinity: false })(
  CreateOrderDto.prototype,
  "unitPrice",
);
Min(0.01)(CreateOrderDto.prototype, "unitPrice");
IsString()(CreateOrderDto.prototype, "currency");
Matches(/^[A-Z]{3}$/u)(CreateOrderDto.prototype, "currency");

class UserParamsDto {}
IsString()(UserParamsDto.prototype, "userId");
Matches(/^\d+$/u)(UserParamsDto.prototype, "userId");

class NestRequestContextMiddleware {
  use(request, _response, next) {
    if (isControlRequest(request)) return next();
    runtime.record("requestId");
    runtime.record("authentication");
    const context = {
      requestId: request.id,
      tenantId: String(request.headers["x-tenant-id"] ?? "benchmark-tenant"),
      traceId: String(request.headers["x-trace-id"] ?? `trace-${request.id}`),
    };
    runtime.record("requestContext");
    requestStore.run(context, next);
  }
}
Injectable()(NestRequestContextMiddleware);

class BenchmarkValidationPipe extends ValidationPipe {
  async transform(value, metadata) {
    if (metadata.type === "body" || metadata.type === "param") {
      runtime.record("validation");
    }
    return super.transform(value, metadata);
  }
}

class JwtOrderGuard {
  constructor(jwtService) {
    this.jwtService = jwtService;
  }

  async canActivate(context) {
    const request = context.switchToHttp().getRequest();
    const header = String(request.headers.authorization ?? "");
    const token = /^Bearer\s+(.+)$/iu.exec(header)?.[1];
    if (!token) throw new UnauthorizedException();
    let payload;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.BENCHMARK_JWT_SECRET ?? JWT_SECRET,
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException();
    }
    runtime.record("authorization");
    if (
      !Array.isArray(payload.roles) ||
      !payload.roles.includes("orders:write")
    ) {
      throw new ForbiddenException();
    }
    request.benchmarkIdentity = payload;
    return true;
  }
}
Reflect.defineMetadata("design:paramtypes", [JwtService], JwtOrderGuard);
Injectable()(JwtOrderGuard);

class QuoteService {
  async quote(context, body) {
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
    return (await response.json()).quote;
  }
}
Injectable()(QuoteService);

class OrderService {
  constructor(quoteService) {
    this.quoteService = quoteService;
  }

  async create(params, body) {
    runtime.record("service");
    await Promise.resolve();
    const context = requestStore.getStore();
    if (!context?.requestId || !context.tenantId || !context.traceId) {
      throw new Error(
        "Nest AsyncLocalStorage context was not propagated into OrderService",
      );
    }
    const subtotal = Number((body.quantity * body.unitPrice).toFixed(2));
    const isExternal = body.sku === "SKU-EXTERNAL-001";
    const externalQuote = isExternal
      ? await this.quoteService.quote(context, body)
      : undefined;
    const discount = isExternal ? Number((subtotal * 0.05).toFixed(2)) : 0;
    const id = runtime.allocateOrderId();
    return {
      data: {
        order: {
          id,
          userId: params.userId,
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
}
Reflect.defineMetadata("design:paramtypes", [QuoteService], OrderService);
Injectable()(OrderService);

class BenchmarkLoggingInterceptor {
  intercept(context, next) {
    const request = context.switchToHttp().getRequest();
    return next.handle().pipe(
      tap(() => {
        request.log.info(
          { requestId: request.id, statusCode: 201 },
          "enterprise.request",
        );
      }),
    );
  }
}
Injectable()(BenchmarkLoggingInterceptor);

class BenchmarkExceptionFilter {
  catch(exception, host) {
    runtime.record("errorHandler");
    const http = host.switchToHttp();
    const request = http.getRequest();
    const reply = http.getResponse();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const requestId = requestStore.getStore()?.requestId ?? request.id;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const rawText = JSON.stringify(raw ?? "");
    const fields =
      status === 422 && rawText.includes("quantity") ? ["quantity"] : undefined;
    const code =
      status === 401
        ? "AUTH_REQUIRED"
        : status === 403
          ? "AUTH_FORBIDDEN"
          : status === 422
            ? "VALIDATION_FAILED"
            : "INTERNAL_ERROR";
    request.log.info(
      { requestId, statusCode: status },
      "enterprise.request.failed",
    );
    reply.code(status).send(createError(code, requestId, fields));
  }
}
Catch()(BenchmarkExceptionFilter);

class OrderController {
  constructor(orderService) {
    this.orderService = orderService;
  }

  async create(params, body) {
    runtime.record("controller");
    return this.orderService.create(params, body);
  }
}
Reflect.defineMetadata("design:paramtypes", [OrderService], OrderController);
Controller("api/users")(OrderController);
const createDescriptor = Object.getOwnPropertyDescriptor(
  OrderController.prototype,
  "create",
);
Reflect.defineMetadata(
  "design:paramtypes",
  [UserParamsDto, CreateOrderDto],
  OrderController.prototype,
  "create",
);
Post(":userId/orders")(OrderController.prototype, "create", createDescriptor);
Param()(OrderController.prototype, "create", 0);
Body()(OrderController.prototype, "create", 1);
UseGuards(JwtOrderGuard)(OrderController.prototype, "create", createDescriptor);
UseInterceptors(BenchmarkLoggingInterceptor)(
  OrderController.prototype,
  "create",
  createDescriptor,
);

class BenchmarkModule {
  configure(consumer) {
    consumer.apply(NestRequestContextMiddleware).forRoutes("*");
  }
}
Module({
  imports: [
    JwtModule.register({
      secret: process.env.BENCHMARK_JWT_SECRET ?? JWT_SECRET,
      signOptions: {
        algorithm: JWT_ALGORITHM,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    }),
  ],
  providers: [
    NestRequestContextMiddleware,
    JwtOrderGuard,
    QuoteService,
    OrderService,
    BenchmarkLoggingInterceptor,
  ],
  controllers: [OrderController],
})(BenchmarkModule);

const raw = Fastify({
  requestIdHeader: "x-request-id",
  disableRequestLogging: true,
  routerOptions: {},
  logger: { level: "info", stream: createDiscardLogStream(runtime) },
});
const adapter = new FastifyAdapter(raw);
await raw.register(helmet, {
  contentSecurityPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  frameguard: { action: "sameorigin" },
});
raw.addHook("onRequest", async (request, reply) => {
  if (!isControlRequest(request)) reply.header("x-request-id", request.id);
});
raw.get(`${CONTROL_PREFIX}/health`, async () => ({
  status: "ok",
  target: "nest-fastify",
}));
raw.post(`${CONTROL_PREFIX}/reset`, async () => runtime.reset());
raw.get(`${CONTROL_PREFIX}/stats`, async () => runtime.snapshot());

let application;
async function start() {
  application = await NestFactory.create(BenchmarkModule, adapter, {
    logger: false,
  });
  application.useGlobalPipes(
    new BenchmarkValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      errorHttpStatusCode: 422,
    }),
  );
  application.useGlobalFilters(new BenchmarkExceptionFilter());
  await application.listen({ host: "127.0.0.1", port });
  const address = raw.server.address();
  process.send?.({
    type: "ready",
    target: "nest-fastify",
    port: typeof address === "object" && address ? address.port : port,
    runtime: { fastify: raw.version, cpuSet: readEffectiveCpuSet() },
  });
}

installOwnedProcessShutdown(() => application?.close(), runtime);
start().catch((error) => {
  process.send?.({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exit(1);
});
