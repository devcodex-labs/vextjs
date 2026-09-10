import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RouteOptions } from "../../types/app.js";
import type { VextRequest } from "../../types/request.js";
import { resolvePathInside } from "../../lib/path-boundary.js";
import { createRouteFreshnessIdentity } from "../contract/schema-ir.js";
import type {
  ResolvedVextFrontendConfig,
  VextClientContract,
  VextClientRouteContract,
  VextFrontendMode,
  VextFrontendRenderManifest,
  VextFrontendStaticArtifact,
  VextFrontendStaticManifest,
} from "../contract/types.js";
import { STABLE_FRONTEND_GENERATED_AT } from "../contract/metadata.js";
import { createFrontendRenderer } from "../runtime/renderer.js";
import type { ArtifactCandidate } from "../../lib/project/artifact-transaction.js";
import {
  buildClientContract,
  type RoutesManifestPayload,
} from "./client-contract-writer.js";

export interface WriteStaticFrontendArtifactsOptions {
  rootDir: string;
  config: ResolvedVextFrontendConfig;
  mode: VextFrontendMode;
}

export interface WriteStaticFrontendArtifactsResult {
  manifestPath: string;
  artifacts: VextFrontendStaticArtifact[];
}

/**
 * Materializes declared `RouteOptions.frontend.mode: "static"` closures after
 * both browser and server build outputs exist. The render is staged first;
 * only a fully successful closure is published into the physical deploy tree.
 */
export async function writeStaticFrontendArtifacts(
  options: WriteStaticFrontendArtifactsOptions,
): Promise<WriteStaticFrontendArtifactsResult> {
  const contract = await readStaticRouteContract(options);
  const renderManifest = JSON.parse(
    await readFile(
      path.join(options.config.outDir, "render-manifest.json"),
      "utf-8",
    ),
  ) as VextFrontendRenderManifest;
  const planned = await createStaticFrontendArtifacts({
    ...options,
    contract,
    renderManifest,
    renderer: createFrontendRenderer({
      rootDir: options.rootDir,
      mode: options.mode,
      config: options.config,
    }),
  });
  const stageDir = path.join(
    options.config.outDir,
    `.vext-static-stage-${randomUUID()}`,
  );
  try {
    await mkdir(stageDir, { recursive: true });
    for (const file of planned.files) {
      if (file.path === planned.result.manifestPath) continue;
      await writeStageFile(
        stageDir,
        path.relative(options.config.outDir, file.path).replaceAll("\\", "/"),
        Buffer.from(file.contents).toString("utf8"),
      );
    }
    await publishStaticStage(
      stageDir,
      options.config.outDir,
      planned.result.artifacts,
    );
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true });
    throw error;
  }

  const manifest = planned.files.find(
    (file) => file.path === planned.result.manifestPath,
  )!;
  await writeFile(manifest.path, manifest.contents);
  return planned.result;
}

export async function createStaticFrontendArtifacts(
  options: WriteStaticFrontendArtifactsOptions & {
    contract: VextClientContract;
    renderManifest: VextFrontendRenderManifest;
    renderer: ReturnType<typeof createFrontendRenderer>;
    signal?: AbortSignal;
  },
): Promise<{
  result: WriteStaticFrontendArtifactsResult;
  files: ArtifactCandidate[];
}> {
  const { contract, renderManifest, renderer } = options;
  const artifacts: VextFrontendStaticArtifact[] = [];
  const files: ArtifactCandidate[] = [];
  for (const route of contract.routes.filter(
    (route) => route.freshness?.mode === "static",
  )) {
    options.signal?.throwIfAborted();
    await createStaticRouteArtifacts({
      route,
      renderManifest,
      renderer,
      artifacts,
      write(relative, contents) {
        const target = resolvePathInside(
          options.config.outDir,
          relative,
          "frontend static artifact path",
          { realpath: true },
        );
        files.push({ path: target, contents });
      },
    });
  }

  const manifest: VextFrontendStaticManifest = {
    schemaVersion: 1,
    kind: "frontend-static-manifest",
    buildId: renderManifest.buildId,
    generatedAt: STABLE_FRONTEND_GENERATED_AT,
    artifacts,
  };
  const manifestPath = path.join(options.config.outDir, "static-manifest.json");
  files.push({
    path: manifestPath,
    contents: `${JSON.stringify(manifest, null, 2)}\n`,
  });
  return { result: { manifestPath, artifacts }, files };
}

async function readStaticRouteContract(
  options: WriteStaticFrontendArtifactsOptions,
): Promise<VextClientContract> {
  const contractPath = path.join(options.config.outDir, "client-contract.json");
  if (existsSync(contractPath)) {
    return JSON.parse(
      await readFile(contractPath, "utf-8"),
    ) as VextClientContract;
  }
  const routeManifestPath = path.join(
    options.rootDir,
    ".vext",
    "manifest",
    "routes.json",
  );
  if (!existsSync(routeManifestPath)) {
    return {
      schemaVersion: 1,
      kind: "client-contract",
      source: "routes-manifest",
      generatedAt: STABLE_FRONTEND_GENERATED_AT,
      routes: [],
      warnings: [],
    };
  }
  return buildClientContract(
    JSON.parse(
      await readFile(routeManifestPath, "utf-8"),
    ) as RoutesManifestPayload,
  );
}

async function createStaticRouteArtifacts(input: {
  route: VextClientRouteContract;
  renderManifest: VextFrontendRenderManifest;
  renderer: ReturnType<typeof createFrontendRenderer>;
  write(relative: string, content: string): void;
  artifacts: VextFrontendStaticArtifact[];
}): Promise<void> {
  const freshness = input.route.freshness;
  if (!freshness || freshness.mode !== "static") return;
  const page = resolveStaticPage(input.route, input.renderManifest);
  const staticParams = freshness.staticParams ?? [{}];
  const budget = freshness.staticBudget;
  if (
    budget?.maxParams !== undefined &&
    staticParams.length > budget.maxParams
  ) {
    throw new Error(
      `[vextjs] static route ${input.route.method} ${input.route.path} declares ${staticParams.length} parameter set(s), exceeding frontend.staticBudget.maxParams=${budget.maxParams}.`,
    );
  }

  const startedAt = Date.now();
  let totalBytes = 0;
  for (const params of staticParams) {
    const routePath = materializeRoutePath(input.route.path, params);
    const request = createStaticRequest(input.route, routePath, params);
    const rendered = input.renderer.renderPage(
      page,
      { params },
      undefined,
      200,
      request,
    );
    const output = toStaticOutput(routePath);
    const html = rendered.html;
    const noHydration = freshness.hydration === "none";
    const data = noHydration
      ? undefined
      : `${JSON.stringify(rendered.payload, null, 2)}\n`;
    const bytes =
      Buffer.byteLength(html) + (data ? Buffer.byteLength(data) : 0);
    totalBytes += bytes;
    if (budget?.maxBytes !== undefined && totalBytes > budget.maxBytes) {
      throw new Error(
        `[vextjs] static route ${input.route.method} ${input.route.path} exceeded frontend.staticBudget.maxBytes=${budget.maxBytes}.`,
      );
    }

    input.write(output.html, html);
    if (data) input.write(output.data, data);
    input.artifacts.push({
      routeId:
        input.route.routeId ?? `${input.route.method} ${input.route.path}`,
      routePath,
      page,
      params: { ...params },
      html: output.html,
      ...(data ? { data: output.data } : {}),
      bytes,
      assets: rendered.payload.assets,
    });
  }
  if (
    budget?.maxDurationMs !== undefined &&
    Date.now() - startedAt > budget.maxDurationMs
  ) {
    throw new Error(
      `[vextjs] static route ${input.route.method} ${input.route.path} exceeded frontend.staticBudget.maxDurationMs=${budget.maxDurationMs}.`,
    );
  }
}

function resolveStaticPage(
  route: VextClientRouteContract,
  manifest: VextFrontendRenderManifest,
): string {
  const explicitPage = route.freshness?.page;
  const page = explicitPage
    ? manifest.pages.find((entry) => entry.id === explicitPage)
    : manifest.pages.find((entry) => entry.routePath === route.path);
  if (!page) {
    throw new Error(
      `[vextjs] static route ${route.method} ${route.path} has no frontend page mapping. Declare RouteOptions.frontend.page or add a matching page routePath.`,
    );
  }
  return page.id;
}

function createStaticRequest(
  route: VextClientRouteContract,
  routePath: string,
  params: Record<string, string>,
): VextRequest {
  const freshness = route.freshness;
  const frontend: RouteOptions["frontend"] = freshness
    ? {
        mode: freshness.mode,
        ...(freshness.revalidate !== undefined
          ? { revalidate: freshness.revalidate }
          : {}),
        ...(freshness.staticParams !== undefined
          ? { staticParams: freshness.staticParams }
          : {}),
        ...(freshness.clientOnly ? { clientOnly: true } : {}),
        ...(freshness.hydration ? { hydration: freshness.hydration } : {}),
        ...(freshness.seo ? { seo: freshness.seo } : {}),
        ...(freshness.tags ? { tags: freshness.tags } : {}),
        ...(freshness.page ? { page: freshness.page } : {}),
        ...(freshness.staticBudget
          ? { staticBudget: freshness.staticBudget }
          : {}),
      }
    : undefined;
  createRouteFreshnessIdentity({ frontend });
  return {
    method: route.method,
    url: routePath,
    path: routePath,
    route: route.path,
    params,
    query: {},
    headers: {},
    cookies: {},
    cookie: () => undefined,
    csrfToken: () => "",
    auth: { isAuthenticated: false },
    _routeOptions: { frontend },
  } as unknown as VextRequest;
}

function materializeRoutePath(
  routePath: string,
  params: Record<string, string>,
): string {
  const result = routePath.replace(
    /:([A-Za-z0-9_]+)/gu,
    (_match, key: string) => {
      const value = params[key];
      if (value === undefined) {
        throw new Error(
          `[vextjs] static route ${routePath} is missing parameter "${key}" in frontend.staticParams.`,
        );
      }
      return encodeURIComponent(value);
    },
  );
  if (/:([A-Za-z0-9_]+)/u.test(result)) {
    throw new Error(
      `[vextjs] static route ${routePath} has unresolved parameters.`,
    );
  }
  return result === "/" ? result : result.replace(/\/+$/u, "");
}

function toStaticOutput(routePath: string): { html: string; data: string } {
  const segment = routePath.replace(/^\/+|\/+$/gu, "");
  const directory = segment || ".";
  return {
    html: path.posix.join(directory, "index.html").replace(/^\.\//u, ""),
    data: path.posix.join(directory, "__vext.page.json").replace(/^\.\//u, ""),
  };
}

async function writeStageFile(
  stageDir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = resolvePathInside(
    stageDir,
    relativePath,
    "frontend static stage artifact path",
    { realpath: true },
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

async function publishStaticStage(
  stageDir: string,
  outDir: string,
  artifacts: VextFrontendStaticArtifact[],
): Promise<void> {
  const files = [
    ...new Set(
      artifacts.flatMap((artifact) =>
        artifact.data ? [artifact.html, artifact.data] : [artifact.html],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  for (const relativePath of files) {
    const source = resolvePathInside(
      stageDir,
      relativePath,
      "frontend static staged artifact path",
      { realpath: true },
    );
    const target = resolvePathInside(
      outDir,
      relativePath,
      "frontend static publish artifact path",
      { realpath: true },
    );
    await mkdir(path.dirname(target), { recursive: true });
    await rename(source, target);
  }
  await rm(stageDir, { recursive: true, force: true });
}
