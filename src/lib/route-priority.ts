const METHOD_PRIORITY = new Map<string, number>([
  ["HEAD", 0],
  ["GET", 1],
]);

export interface RoutePriorityInput {
  method: string;
  path: string;
}

export function compareRoutePriority(
  a: RoutePriorityInput,
  b: RoutePriorityInput,
): number {
  const methodDelta = methodPriority(a.method) - methodPriority(b.method);
  if (methodDelta !== 0 && equivalentPathShape(a.path, b.path)) {
    return methodDelta;
  }

  const aScore = scoreRoutePath(a.path);
  const bScore = scoreRoutePath(b.path);

  if (aScore.wildcards !== bScore.wildcards) {
    return aScore.wildcards - bScore.wildcards;
  }
  if (aScore.params !== bScore.params) {
    return aScore.params - bScore.params;
  }
  if (aScore.staticSegments !== bScore.staticSegments) {
    return bScore.staticSegments - aScore.staticSegments;
  }
  if (aScore.segments !== bScore.segments) {
    return bScore.segments - aScore.segments;
  }
  if (aScore.staticChars !== bScore.staticChars) {
    return bScore.staticChars - aScore.staticChars;
  }

  if (methodDelta !== 0) return methodDelta;
  return a.path.localeCompare(b.path);
}

function methodPriority(method: string): number {
  return METHOD_PRIORITY.get(method.toUpperCase()) ?? 10;
}

function equivalentPathShape(a: string, b: string): boolean {
  return normalizePathShape(a) === normalizePathShape(b);
}

function normalizePathShape(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (isWildcardSegment(segment)) return "*";
      if (isParamSegment(segment)) return ":";
      return segment;
    })
    .join("/");
}

function scoreRoutePath(path: string): {
  segments: number;
  staticSegments: number;
  staticChars: number;
  params: number;
  wildcards: number;
} {
  const segments = path.split("/").filter(Boolean);
  let staticSegments = 0;
  let staticChars = 0;
  let params = 0;
  let wildcards = 0;

  for (const segment of segments) {
    if (isWildcardSegment(segment)) {
      wildcards += 1;
    } else if (isParamSegment(segment)) {
      params += 1;
    } else {
      staticSegments += 1;
      staticChars += segment.length;
    }
  }

  return {
    segments: segments.length,
    staticSegments,
    staticChars,
    params,
    wildcards,
  };
}

function isParamSegment(segment: string): boolean {
  return segment.startsWith(":") || /^\[[^/\]]+\]$/u.test(segment);
}

function isWildcardSegment(segment: string): boolean {
  return segment.startsWith("*") || segment.startsWith("{*");
}
