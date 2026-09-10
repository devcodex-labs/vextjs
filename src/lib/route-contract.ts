import { extname, relative, sep } from "node:path";
import { validateRouteFactorySource } from "./route-factory-contract.js";
export {
  VEXT_ROUTE_METHODS,
  isVextRouteMethod,
  type VextRouteMethod,
} from "./route-factory-contract.js";

export interface CanonicalRouteFactoryValidationOptions {
  validateHandler?: boolean;
  /** Accept only the top-level comma sequence emitted by minified CJS builds. */
  allowCompilerLoweredSequence?: boolean;
}

/**
 * Canonical route-file prefix projection shared by runtime registration,
 * project indexing, Doctor, and parity tests.
 */
export function projectRouteFilePrefix(
  filePath: string,
  routesDir: string,
): string {
  let relativePath = relative(routesDir, filePath).split(sep).join("/");
  const extension = extname(relativePath);
  relativePath = relativePath.slice(0, -extension.length);

  if (relativePath === "index") {
    relativePath = "";
  } else if (relativePath.endsWith("/index")) {
    relativePath = relativePath.slice(0, -"/index".length);
  }

  relativePath = relativePath.replace(/\[([^\]]+)\]/gu, ":$1");
  if (!relativePath.startsWith("/")) relativePath = `/${relativePath}`;
  return relativePath.length > 1 && relativePath.endsWith("/")
    ? relativePath.slice(0, -1)
    : relativePath;
}

/** Canonical path join used by runtime registration and static projection. */
export function normalizeRegisteredRoutePath(
  prefix: string,
  subPath: string,
): string {
  const cleanPrefix =
    prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
  const cleanSubPath = subPath.startsWith("/") ? subPath.slice(1) : subPath;
  const joined = !cleanSubPath
    ? cleanPrefix || "/"
    : cleanPrefix === "/"
      ? `/${cleanSubPath}`
      : `${cleanPrefix}/${cleanSubPath}`;
  return joined.length > 1 ? joined.replace(/\/+$/u, "") : joined;
}

/**
 * Adapters differ in case and trailing-slash matching. Reject identities that
 * would be ambiguous on any supported adapter before registration.
 */
export function createCanonicalRouteIdentity(
  method: string,
  routePath: string,
): string {
  const normalizedPath =
    routePath.length > 1 ? routePath.replace(/\/+$/u, "") : routePath;
  return `${method.toUpperCase()} ${normalizedPath.toLocaleLowerCase("en-US")}`;
}

export function assertCanonicalRouteFactorySource(
  factorySource: string,
  label = "defineRoutes(factory)",
  options: CanonicalRouteFactoryValidationOptions = {},
): number {
  return validateRouteFactorySource(factorySource, label, options);
}

export function assertCanonicalRouteFactoryBody(
  paramName: string,
  body: string,
  label: string,
  options: CanonicalRouteFactoryValidationOptions = {},
): number {
  return validateRouteFactorySource(
    `(${paramName}) => {${body}}`,
    label,
    options,
  );
}
