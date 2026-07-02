import type {
  VextDocsAccessDescriptor,
  VextDocsOpenAPIDocument,
} from "../types.js";

export const OPENAPI_HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
] as const;

export function isOpenAPIHttpMethod(method: string): boolean {
  return OPENAPI_HTTP_METHODS.includes(
    method.toLowerCase() as (typeof OPENAPI_HTTP_METHODS)[number],
  );
}

export function getOpenAPIOperationTags(operation: unknown): string[] {
  if (
    typeof operation !== "object" ||
    operation === null ||
    !Array.isArray((operation as Record<string, unknown>).tags)
  ) {
    return [];
  }
  return ((operation as Record<string, unknown>).tags as unknown[]).filter(
    (tag): tag is string => typeof tag === "string",
  );
}

export function createOpenAPIOperationDescriptor(
  path: string,
  method: string,
  operation: unknown,
): Extract<VextDocsAccessDescriptor, { kind: "operation" }> {
  const operationRecord =
    typeof operation === "object" && operation !== null
      ? (operation as Record<string, unknown>)
      : {};
  const operationId =
    typeof operationRecord.operationId === "string"
      ? operationRecord.operationId
      : undefined;

  return {
    kind: "operation",
    id: operationId ?? `${method.toUpperCase()} ${path}`,
    method: method.toUpperCase(),
    path,
    tags: getOpenAPIOperationTags(operation),
    operationId,
  };
}

export function collectOpenAPITags(document: VextDocsOpenAPIDocument): Set<string> {
  const tags = new Set<string>();
  const paths = document.paths ?? {};
  for (const pathItem of Object.values(paths)) {
    if (typeof pathItem !== "object" || pathItem === null) {
      continue;
    }
    for (const [method, operation] of Object.entries(
      pathItem as Record<string, unknown>,
    )) {
      if (!isOpenAPIHttpMethod(method)) {
        continue;
      }
      for (const tag of getOpenAPIOperationTags(operation)) {
        tags.add(tag);
      }
    }
  }
  return tags;
}
