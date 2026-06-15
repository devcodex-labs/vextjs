import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { VextMiddleware } from "../../types/middleware.js";
import type { VextFrontendMode, VextFrontendUserConfig } from "../contract/types.js";
import { resolveFrontendConfig } from "../tooling/config-resolver.js";

export interface CreateFrontendNotFoundHandlerOptions {
  rootDir: string;
  mode: VextFrontendMode;
  config: VextFrontendUserConfig | undefined;
  fallbackHandler: VextMiddleware;
}

export function createFrontendNotFoundHandler(
  options: CreateFrontendNotFoundHandlerOptions,
): VextMiddleware {
  const config = resolveFrontendConfig(options.config, {
    rootDir: options.rootDir,
    mode: options.mode,
  });
  if (!config.enabled) {
    return options.fallbackHandler;
  }

  return async (req, res, next) => {
    if (!isStaticMethod(req.method)) {
      return options.fallbackHandler(req, res, next);
    }

    const assetPath = resolveAssetPath(config.outDir, config.publicPath, req.path);
    if (assetPath) {
      const served = serveFile(req, res, assetPath);
      if (served) return;
    }

    if (shouldServeFallback(req.path, req.headers.accept, config.spaFallback)) {
      const indexPath = path.join(config.outDir, "index.html");
      res.setHeader("Vary", "Accept");
      if (serveFile(req, res, indexPath, "text/html; charset=utf-8")) return;
    }

    return options.fallbackHandler(req, res, next);
  };
}

export function assertFrontendOutputReady(
  options: CreateFrontendNotFoundHandlerOptions,
): void {
  const config = resolveFrontendConfig(options.config, {
    rootDir: options.rootDir,
    mode: options.mode,
  });
  if (!config.enabled) return;

  const indexPath = path.join(config.outDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(
      `[vextjs] frontend output is missing: ${path.relative(options.rootDir, indexPath)}. Run "vext build" first.`,
    );
  }
}

function isStaticMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function resolveAssetPath(
  staticRoot: string,
  publicPath: string,
  requestPath: string,
): string | null {
  const pathname = safeDecodePath(requestPath);
  if (!pathname) return null;

  const normalizedPublicPath = publicPath === "/" ? "/" : publicPath.replace(/\/$/, "");
  if (normalizedPublicPath !== "/" && pathname !== normalizedPublicPath) {
    if (!pathname.startsWith(`${normalizedPublicPath}/`)) return null;
  }

  const relativeAsset =
    normalizedPublicPath === "/"
      ? pathname.replace(/^\/+/, "")
      : pathname.slice(normalizedPublicPath.length).replace(/^\/+/, "");
  if (!relativeAsset || relativeAsset.endsWith("/")) return null;

  const normalizedAsset = path.posix.normalize(relativeAsset);
  if (normalizedAsset.startsWith("../")) return null;

  const candidate = path.resolve(staticRoot, normalizedAsset);
  const relative = path.relative(staticRoot, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

function serveFile(
  req: { method: string; headers: Record<string, string | undefined> },
  res: Parameters<VextMiddleware>[1],
  filePath: string,
  forcedContentType?: string,
): boolean {
  if (!existsSync(filePath)) return false;

  const stat = statSync(filePath);
  if (!stat.isFile()) return false;

  const etag = `W/"${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
  res
    .setHeader("ETag", etag)
    .setHeader("Last-Modified", stat.mtime.toUTCString())
    .setHeader("Cache-Control", cacheControlFor(filePath))
    .setHeader("Content-Type", forcedContentType ?? mimeTypeFor(filePath));

  if (req.headers["if-none-match"] === etag) {
    res.status(304).text("");
    return true;
  }

  res.setHeader("Content-Length", String(stat.size));

  if (req.method === "HEAD") {
    res.status(200).text("");
    return true;
  }

  res.stream(createReadStream(filePath), forcedContentType ?? mimeTypeFor(filePath));
  return true;
}

function shouldServeFallback(
  requestPath: string,
  acceptHeader: string | undefined,
  fallback: { enabled: boolean; exclude: string[] },
): boolean {
  if (!fallback.enabled) return false;
  if (!acceptsHtml(acceptHeader)) return false;
  const pathname = safeDecodePath(requestPath);
  if (!pathname) return false;
  if (path.extname(pathname)) return false;
  return !fallback.exclude.some((pattern) => matchPathPattern(pathname, pattern));
}

function acceptsHtml(acceptHeader: string | undefined): boolean {
  if (!acceptHeader) return true;
  return acceptHeader
    .split(",")
    .map((entry) => entry.trim().toLowerCase().split(";")[0])
    .some((type) => type === "text/html" || type === "*/*");
}

function matchPathPattern(pathname: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    const base = pattern.slice(0, -"/**".length);
    return pathname === base || pathname.startsWith(`${base}/`);
  }
  return pathname === pattern;
}

function safeDecodePath(value: string): string | null {
  const raw = value.split("?")[0] || "/";
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.includes("\0")) return null;
    return decoded.startsWith("/") ? decoded : `/${decoded}`;
  } catch {
    return null;
  }
}

function cacheControlFor(filePath: string): string {
  return path.basename(filePath) === "index.html"
    ? "no-cache"
    : "public, max-age=31536000, immutable";
}

function mimeTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
