export const FRAMEWORK_NATIVE_MANIFEST_VERSION =
  "framework-native-product-stack-v1";

/**
 * Provenance intentionally means documented/recommended production path. A
 * maintained ecosystem package is valid when its maintainer documentation
 * supports the integration; package ownership alone is not the criterion.
 */
export const FRAMEWORK_NATIVE_IMPLEMENTATION_MANIFEST = Object.freeze({
  version: FRAMEWORK_NATIVE_MANIFEST_VERSION,
  targets: {
    "vext-native": {
      label: "VextJS + Native Adapter",
      requestContext:
        "Vext request ID plus built-in AsyncLocalStorage requestContext",
      authentication:
        "Vext auth() with jose JWT verification and route permission requirement",
      validation: "Vext compiled route validate schema",
      serviceComposition: "Vext startup-loaded app.services",
      logging:
        "Vext access log and logger writing to an in-process discard sink",
      securityHeaders: "Vext config.securityHeaders preset: basic",
      provenance: [
        {
          kind: "framework-documentation",
          package: "vextjs",
          url: "https://devcodex-labs.github.io/vextjs/api/config.html",
          purpose:
            "request context, security headers, access logging and route configuration",
        },
        {
          kind: "framework-documentation",
          package: "vextjs",
          url: "https://devcodex-labs.github.io/vextjs/examples/crud-api.html",
          purpose: "auth() production JWT integration guidance",
        },
        {
          kind: "maintainer-documentation",
          package: "jose",
          url: "https://github.com/panva/jose",
          purpose: "JOSE/JWT signature and claims verification",
        },
      ],
    },
    "fastify-native": {
      label: "Fastify",
      requestContext: "@fastify/request-context AsyncLocalStorage plugin",
      authentication: "@fastify/jwt request.jwtVerify() route hook",
      validation: "Fastify route JSON Schema validation",
      serviceComposition: "startup-composed closures",
      logging:
        "Fastify structured logger writing to an in-process discard sink",
      securityHeaders: "@fastify/helmet with the common basic-header contract",
      provenance: [
        {
          kind: "maintainer-documentation",
          package: "@fastify/request-context",
          url: "https://github.com/fastify/fastify-request-context",
          purpose: "request-scoped AsyncLocalStorage",
        },
        {
          kind: "maintainer-documentation",
          package: "@fastify/jwt",
          url: "https://github.com/fastify/fastify-jwt",
          purpose: "JWT verification in Fastify route hooks",
        },
        {
          kind: "maintainer-documentation",
          package: "@fastify/helmet",
          url: "https://github.com/fastify/fastify-helmet",
          purpose: "security response headers",
        },
      ],
    },
    "nest-fastify": {
      label: "NestJS + Fastify",
      requestContext: "Nest AsyncLocalStorage middleware recipe",
      authentication: "@nestjs/jwt JwtService in a CanActivate guard",
      validation:
        "ValidationPipe with DTO decorators, class-validator and class-transformer",
      serviceComposition: "Nest Provider constructor injection",
      logging:
        "Fastify host logger plus Nest interceptor/filter to an in-process discard sink",
      securityHeaders: "@fastify/helmet on the Fastify host",
      provenance: [
        {
          kind: "framework-documentation",
          package: "@nestjs/core",
          url: "https://docs.nestjs.com/recipes/async-local-storage",
          purpose: "AsyncLocalStorage middleware recipe",
        },
        {
          kind: "framework-documentation",
          package: "@nestjs/jwt",
          url: "https://docs.nestjs.com/security/authentication",
          purpose: "JWT utility package and protected routes",
        },
        {
          kind: "framework-documentation",
          package: "class-validator,class-transformer",
          url: "https://docs.nestjs.com/techniques/validation",
          purpose: "ValidationPipe DTO validation",
        },
      ],
    },
  },
});

export function assertImplementationManifest(
  manifest = FRAMEWORK_NATIVE_IMPLEMENTATION_MANIFEST,
) {
  for (const [targetId, target] of Object.entries(manifest.targets ?? {})) {
    if (
      !target.label ||
      !Array.isArray(target.provenance) ||
      target.provenance.length === 0
    ) {
      throw new Error(`Implementation manifest is incomplete for ${targetId}`);
    }
    for (const entry of target.provenance) {
      if (
        !entry.kind ||
        !entry.package ||
        !/^https:\/\//u.test(entry.url ?? "")
      ) {
        throw new Error(
          `Implementation provenance is incomplete for ${targetId}`,
        );
      }
    }
  }
  return manifest;
}
