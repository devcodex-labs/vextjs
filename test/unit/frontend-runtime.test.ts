import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { resolveFrontendConfig } from "../../src/frontend/tooling/config-resolver.js";
import { buildClientContract } from "../../src/frontend/tooling/client-contract-writer.js";
import { buildFrontendClient } from "../../src/frontend/tooling/client-build-compiler.js";
import {
  VextApiError,
  createVextApiClient,
  isVextApiError,
} from "../../src/frontend/index.js";
import { createFrontendNotFoundHandler } from "../../src/frontend/runtime/static-mount.js";

const tempDirs: string[] = [];
const pendingStreams: Promise<void>[] = [];

afterEach(async () => {
  await Promise.allSettled(pendingStreams.splice(0));
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("frontend config resolver", () => {
  it("defaults to disabled frontend", async () => {
    const rootDir = await tempRoot();
    const config = resolveFrontendConfig(undefined, {
      rootDir,
      mode: "production",
    });

    expect(config.enabled).toBe(false);
    expect(config.framework).toBe("react");
    expect(config.publicPath).toBe("/");
  });

  it("normalizes enabled frontend paths inside project root", async () => {
    const rootDir = await tempRoot();
    const config = resolveFrontendConfig(true, {
      rootDir,
      mode: "development",
    });

    expect(config.enabled).toBe(true);
    expect(config.outDir).toBe(path.join(rootDir, ".vext", "client"));
    expect(config.spaFallback.exclude).toContain("/api/**");
  });

  it("rejects paths outside project root", async () => {
    const rootDir = await tempRoot();

    expect(() =>
      resolveFrontendConfig(
        { enabled: true, outDir: "../outside" },
        { rootDir, mode: "production" },
      ),
    ).toThrow("config.frontend.outDir");
  });
});

describe("frontend client contract", () => {
  it("builds a public client contract from route manifest records", () => {
    const contract = buildClientContract({
      routes: [
        {
          method: "GET",
          path: "/api/hello",
          operationId: "getApiHello",
          docsSummary: "Hello",
          tags: ["example"],
        },
        {
          method: "GET",
          path: "/internal",
          operationId: "getInternal",
          hidden: true,
        },
      ],
    });

    expect(contract.kind).toBe("client-contract");
    expect(contract.routes).toHaveLength(1);
    expect(contract.routes[0]?.path).toBe("/api/hello");
  });
});

describe("frontend client build", () => {
  it("injects bundled CSS and entry script into index.html", async () => {
    const rootDir = await tempRoot();
    const clientDir = path.join(rootDir, "src", "client");
    await mkdir(clientDir, { recursive: true });
    await writeFile(
      path.join(clientDir, "main.js"),
      'import "./styles.css";\ndocument.body.dataset.ready = "1";\n',
    );
    await writeFile(
      path.join(clientDir, "styles.css"),
      "body { color: red; }\n",
    );
    await writeFile(
      path.join(clientDir, "index.html"),
      '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    );

    const result = await buildFrontendClient({
      rootDir,
      mode: "production",
      config: {
        enabled: true,
        entry: "src/client/main.js",
        indexHtml: "src/client/index.html",
        apiClient: false,
      },
    });

    const html = await readFile(
      path.join(result.config.outDir, "index.html"),
      "utf-8",
    );
    expect(html).toMatch(
      /<link rel="stylesheet" href="\/assets\/main-[^"]+\.css" data-vext-style>/,
    );
    expect(html).toMatch(
      /<script type="module" src="\/assets\/main-[^"]+\.js" data-vext-entry><\/script>/,
    );
  });
});

describe("frontend api client", () => {
  const contract = {
    schemaVersion: 1,
    kind: "client-contract",
    source: "routes-manifest",
    generatedAt: "test",
    routes: [{ method: "GET", path: "/api/hello", operationId: "getApiHello" }],
    warnings: [],
  } as const;

  it("unwraps standard vext JSON responses", async () => {
    const api = createVextApiClient(contract, {
      baseUrl: "https://example.test",
      fetch: async () =>
        new Response(JSON.stringify({ code: 0, data: { ok: true } }), {
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(api.GET("/api/hello")).resolves.toEqual({ ok: true });
  });

  it("throws VextApiError for non-2xx responses", async () => {
    const api = createVextApiClient(contract, {
      baseUrl: "https://example.test",
      fetch: async () =>
        new Response(JSON.stringify({ code: 404, message: "Missing" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(api.GET("/api/hello")).rejects.toBeInstanceOf(VextApiError);
    try {
      await api.GET("/api/hello");
    } catch (error) {
      expect(isVextApiError(error)).toBe(true);
      expect((error as VextApiError).status).toBe(404);
    }
  });
});

describe("frontend static mount", () => {
  it("serves SPA fallback and delegates API paths to original 404", async () => {
    const rootDir = await tempRoot();
    const outDir = path.join(rootDir, "dist", "client");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "index.html"), "<main>app</main>");

    let fallbackCalled = 0;
    const handler = createFrontendNotFoundHandler({
      rootDir,
      mode: "production",
      config: { enabled: true },
      fallbackHandler: async (_req, res) => {
        fallbackCalled += 1;
        res.rawJson({ code: 404 }, 404);
      },
    });

    const pageRes = createMockResponse();
    await handler(createMockRequest("/dashboard"), pageRes, async () => {});
    expect(pageRes.streamed).toBe(true);
    expect(pageRes.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(pageRes.headers.Vary).toBe("Accept");

    const jsonRes = createMockResponse();
    await handler(
      createMockRequest("/dashboard", { accept: "application/json" }),
      jsonRes,
      async () => {},
    );
    expect(fallbackCalled).toBe(1);
    expect(jsonRes.statusCode).toBe(404);

    const apiRes = createMockResponse();
    await handler(createMockRequest("/api/missing"), apiRes, async () => {});
    expect(fallbackCalled).toBe(2);
    expect(apiRes.statusCode).toBe(404);
  });

  it("serves conditional static requests without source entity length on 304", async () => {
    const rootDir = await tempRoot();
    const outDir = path.join(rootDir, "dist", "client");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "index.html"), "<main>app</main>");

    const handler = createFrontendNotFoundHandler({
      rootDir,
      mode: "production",
      config: { enabled: true },
      fallbackHandler: async (_req, res) => {
        res.rawJson({ code: 404 }, 404);
      },
    });

    const firstRes = createMockResponse();
    await handler(createMockRequest("/index.html"), firstRes, async () => {});
    expect(firstRes.headers.ETag).toBeDefined();
    expect(firstRes.headers["Content-Length"]).toBe("16");

    const conditionalRes = createMockResponse();
    await handler(
      createMockRequest("/index.html", {
        "if-none-match": firstRes.headers.ETag,
      }),
      conditionalRes,
      async () => {},
    );

    expect(conditionalRes.statusCode).toBe(304);
    expect(conditionalRes.headers["Content-Length"]).not.toBe("16");
  });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vext-frontend-"));
  tempDirs.push(dir);
  return dir;
}

function createMockRequest(
  pathname: string,
  headers: Record<string, string | undefined> = {},
) {
  return {
    method: "GET",
    path: pathname,
    headers,
    requestId: "req-1",
  } as any;
}

function createMockResponse() {
  const res = {
    headers: {} as Record<string, string>,
    statusCode: 200,
    streamed: false,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    text(_content: string, status?: number) {
      if (status) this.statusCode = status;
    },
    rawJson(_data: unknown, status?: number) {
      if (status) this.statusCode = status;
    },
    stream(readable: NodeJS.ReadableStream) {
      trackReadable(readable);
      this.streamed = true;
    },
  };
  return res as any;
}

function trackReadable(readable: NodeJS.ReadableStream): void {
  pendingStreams.push(
    new Promise<void>((resolve) => {
      let settled = false;
      const stream = readable as NodeJS.ReadableStream & {
        off?: (event: string, listener: () => void) => void;
        resume?: () => unknown;
      };
      const done = () => {
        if (settled) return;
        settled = true;
        stream.off?.("close", done);
        stream.off?.("end", done);
        stream.off?.("error", done);
        resolve();
      };

      stream.once("close", done);
      stream.once("end", done);
      stream.once("error", done);
      stream.resume?.();
    }),
  );
}
