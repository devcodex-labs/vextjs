import type {
  ResolvedVextDocsAccessConfig,
  VextDocsAccessDescriptor,
  VextDocsAccessResult,
  VextDocsRequestContext,
} from "../types.js";

export interface NormalizedDocsAccessResult {
  visible: boolean;
  tryItOut: boolean;
}

export async function resolveDocsAccess(
  access: ResolvedVextDocsAccessConfig,
  descriptor: VextDocsAccessDescriptor,
  request?: VextDocsRequestContext,
): Promise<NormalizedDocsAccessResult> {
  if (!access.resolver) {
    return { visible: true, tryItOut: true };
  }

  const result = await access.resolver({
    descriptor,
    request,
    viewer: request?.viewer,
  });
  return normalizeDocsAccessResult(result);
}

export function normalizeDocsAccessResult(
  result: VextDocsAccessResult,
): NormalizedDocsAccessResult {
  if (typeof result === "boolean") {
    return { visible: result, tryItOut: result };
  }
  return {
    visible: result.visible ?? true,
    tryItOut: result.tryItOut ?? true,
  };
}
