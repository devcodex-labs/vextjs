import helmet from "@fastify/helmet";
import {
  Body,
  Catch,
  Controller,
  ForbiddenException,
  HttpException,
  Injectable,
  Inject,
  Module,
  Param,
  Post,
  UnprocessableEntityException,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import {
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Min,
  MinLength,
  MaxLength,
} from "class-validator";
import Fastify, { LogController } from "fastify";
import { AsyncLocalStorage } from "node:async_hooks";
import "reflect-metadata";

import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
  ORDER_PATH,
} from "./contract.mjs";
import {
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

/**
 * Nest's Fastify host, ALS middleware, JWT Guard, ValidationPipe, Provider
 * graph and ExceptionFilter stay in the normal request path. Observation is
 * injected only through conformance-owned repository/quote/log values.
 */
export async function createNestApplication({
  repository,
  quoteClient,
  logStream,
}) {
  const requestStore = new AsyncLocalStorage();
  const REPOSITORY = Symbol("framework-native-v2-repository");
  const QUOTE_CLIENT = Symbol("framework-native-v2-quote-client");
  const REQUEST_STORE = Symbol("framework-native-v2-request-store");

  class NestRequestContextMiddleware {
    use(request, _response, next) {
      const context = {
        requestId: request.id,
        tenantId: String(request.headers["x-tenant-id"] ?? "benchmark-tenant"),
        traceId: String(request.headers["x-trace-id"] ?? `trace-${request.id}`),
      };
      requestStore.run(context, next);
    }
  }
  Injectable()(NestRequestContextMiddleware);

  class JwtOrderGuard {
    constructor(jwtService) {
      this.jwtService = jwtService;
    }

    async canActivate(executionContext) {
      const request = executionContext.switchToHttp().getRequest();
      const token = /^Bearer\s+(.+)$/iu.exec(
        String(request.headers.authorization ?? ""),
      )?.[1];
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
      if (
        !Array.isArray(payload.roles) ||
        !payload.roles.includes("orders:write")
      ) {
        throw new ForbiddenException();
      }
      return true;
    }
  }
  Reflect.defineMetadata("design:paramtypes", [JwtService], JwtOrderGuard);
  Injectable()(JwtOrderGuard);

  class NestOrderService {
    constructor(repositoryValue, quoteClientValue, requestStoreValue) {
      this.orderService = new OrderService({
        repository: repositoryValue,
        quoteClient: quoteClientValue,
      });
      this.requestStore = requestStoreValue;
    }

    async create(params, body) {
      return this.orderService.create({
        userId: params.userId,
        body,
        context: this.requestStore.getStore(),
      });
    }
  }
  Inject(REPOSITORY)(NestOrderService, undefined, 0);
  Inject(QUOTE_CLIENT)(NestOrderService, undefined, 1);
  Inject(REQUEST_STORE)(NestOrderService, undefined, 2);
  Reflect.defineMetadata(
    "design:paramtypes",
    [Object, Object, AsyncLocalStorage],
    NestOrderService,
  );
  Injectable()(NestOrderService);

  class BenchmarkExceptionFilter {
    catch(exception, host) {
      const http = host.switchToHttp();
      const request = http.getRequest();
      const response = http.getResponse();
      const statusCode =
        exception instanceof HttpException ? exception.getStatus() : 500;
      const raw =
        exception instanceof HttpException
          ? exception.getResponse()
          : undefined;
      const code =
        statusCode === 401
          ? "AUTH_REQUIRED"
          : statusCode === 403
            ? "AUTH_FORBIDDEN"
            : statusCode === 422 || statusCode === 400
              ? "VALIDATION_FAILED"
              : "INTERNAL_ERROR";
      const fields =
        code === "VALIDATION_FAILED"
          ? normalizeValidationFields(raw)
          : undefined;
      const payload = createError(code, request.id, fields);
      if (statusCode >= 500) {
        request.log?.error?.(
          { err: exception, requestId: request.id },
          "enterprise.error",
        );
      }
      const normalizedStatus = code === "VALIDATION_FAILED" ? 422 : statusCode;
      if (typeof response.code === "function") {
        response
          .header("x-request-id", request.id)
          .code(normalizedStatus)
          .send(payload);
      } else {
        response.statusCode = normalizedStatus;
        response.setHeader("content-type", "application/json");
        response.setHeader("x-request-id", request.id);
        response.end(JSON.stringify(payload));
      }
    }
  }
  Catch()(BenchmarkExceptionFilter);

  class OrderController {
    constructor(orderService) {
      this.orderService = orderService;
    }

    async create(params, body) {
      return this.orderService.create(params, body);
    }
  }
  Reflect.defineMetadata(
    "design:paramtypes",
    [NestOrderService],
    OrderController,
  );
  Controller("api/users")(OrderController);
  const descriptor = Object.getOwnPropertyDescriptor(
    OrderController.prototype,
    "create",
  );
  Reflect.defineMetadata(
    "design:paramtypes",
    [UserParamsDto, CreateOrderDto],
    OrderController.prototype,
    "create",
  );
  Post(":userId/orders")(OrderController.prototype, "create", descriptor);
  Param()(OrderController.prototype, "create", 0);
  Body()(OrderController.prototype, "create", 1);
  UseGuards(JwtOrderGuard)(OrderController.prototype, "create", descriptor);

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
      { provide: REPOSITORY, useValue: repository },
      { provide: QUOTE_CLIENT, useValue: quoteClient },
      { provide: REQUEST_STORE, useValue: requestStore },
      NestRequestContextMiddleware,
      JwtOrderGuard,
      NestOrderService,
    ],
    controllers: [OrderController],
  })(BenchmarkModule);

  const raw = Fastify({
    requestIdHeader: "x-request-id",
    routerOptions: {},
    logController: new LogController({ disableRequestLogging: true }),
    logger: { level: "info", stream: logStream },
  });
  await raw.register(helmet, {
    contentSecurityPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "sameorigin" },
  });
  raw.addHook("onRequest", async (request, reply) => {
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
  raw.addHook("onResponse", async (request, reply) => {
    request.log.info(
      accessLogPayload(request, reply.statusCode, reply.elapsedTime),
      "enterprise.access",
    );
  });

  const adapter = new FastifyAdapter(raw);
  const application = await NestFactory.create(BenchmarkModule, adapter, {
    logger: false,
  });
  application.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
      forbidNonWhitelisted: true,
      errorHttpStatusCode: 422,
      exceptionFactory: (errors) =>
        new UnprocessableEntityException({ errors }),
    }),
  );
  application.useGlobalFilters(new BenchmarkExceptionFilter());

  return { application, raw };
}
