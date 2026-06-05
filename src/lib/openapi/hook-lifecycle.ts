import type { VextApp } from "../../types/app.js";
import type {
  VextInternalHooks,
  VextOpenAPIAfterGeneratePatch,
} from "../../types/hooks.js";
import type { OpenAPIGenerator } from "./generator.js";
import type { OpenAPIDocument, RouteMetadata } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function generateOpenAPIDocumentWithHooks(
  app: VextApp,
  generator: OpenAPIGenerator,
  routes: RouteMetadata[],
): OpenAPIDocument {
  const hooks = app.hooks as VextInternalHooks;

  hooks.emitSafeSync("openapi:beforeGenerate", { routes });

  let document = generator.generate(routes);
  const patch = hooks.emitSafeSync("openapi:afterGenerate", {
    routes,
    document,
  }) as VextOpenAPIAfterGeneratePatch | OpenAPIDocument | undefined;

  if (isObject(patch)) {
    if ("document" in patch && isObject(patch.document)) {
      document = patch.document as unknown as OpenAPIDocument;
    } else if ("openapi" in patch) {
      document = patch as unknown as OpenAPIDocument;
    }
  }

  return document;
}
