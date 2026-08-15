import { ENTERPRISE_TARGETS } from "./contract.mjs";

/**
 * Mapping recorded into every artifact. It documents semantic equivalence
 * without pretending that different framework abstractions are identical.
 */
export const ENTERPRISE_ARCHITECTURE_MAPPING = Object.freeze({
  contract: {
    request:
      "POST /api/users/:userId/orders with JSON body, bearer auth, request/tenant/trace headers",
    success: "201 JSON order envelope and no more than one repository write",
    failures:
      "401 missing auth, 403 denied permission, 422 invalid body, rejected method/content type",
  },
  targets: {
    "vext-native": {
      requestContext: "Vext request ID and AsyncLocalStorage request context",
      auth: "Vext auth middleware plus route permission guard",
      validation: "Vext route validation compiled during registration",
      serviceComposition: "Vext service loader and app.services",
      middleware: "Three Vext global plugin middlewares plus access logging",
    },
    "fastify-native": {
      requestContext: "Fastify request decorators and hooks",
      auth: "Fastify onRequest/preValidation hooks",
      validation: "Fastify route JSON Schema validation",
      serviceComposition: "Explicit startup-composed service closures",
      middleware: "Fastify lifecycle hooks and structured Pino logging",
    },
    "nest-fastify": {
      requestContext: "Fastify host request context",
      auth: "Nest Guard hosted by Fastify",
      validation: "Nest Pipes",
      serviceComposition: "Nest providers with constructor/factory injection",
      middleware:
        "Fastify host hooks plus Nest interceptor/filter and structured Pino logging",
    },
  },
  intentionallyNotEqual: [
    "Internal middleware count",
    "Dependency-injection implementation",
    "Error serialization internals",
    "Framework-specific package graph",
  ],
  phaseTwoExcluded: {
    hono: "No project-evidenced Hono validation and service-composition architecture is available yet; a temporary substitute would make the comparison less fair.",
  },
});

export function getTargetDefinition(targetId) {
  const target = ENTERPRISE_TARGETS.find((entry) => entry.id === targetId);
  if (!target) {
    throw new Error(`Unknown enterprise benchmark target: ${targetId}`);
  }
  return target;
}
