import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadMiddlewares,
  resolveMiddleware,
  validateMiddlewareRefs,
} from "../../src/lib/middleware-loader.js";
import type { MiddlewareRegistry } from "../../src/lib/middleware-loader.js";
import type { VextLogger } from "../../src/types/app.js";

describe("middleware loader declaration contract", () => {
  let middlewareDir: string;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as VextLogger;

  beforeEach(() => {
    middlewareDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vext-middleware-loader-"),
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(middlewareDir, { recursive: true, force: true });
  });

  it("does not load or register declarations with enabled=false", async () => {
    const registry = await loadMiddlewares(
      middlewareDir,
      [{ name: "missing", enabled: false }],
      logger,
    );

    expect(Object.keys(registry)).toEqual([]);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("rejects duplicate names before registry overwrite", async () => {
    await expect(
      loadMiddlewares(middlewareDir, ["auth", "auth"], logger),
    ).rejects.toThrow('Middleware "auth" is declared more than once');
  });

  it("rejects reserved prototype names in middleware declarations", async () => {
    await expect(
      loadMiddlewares(middlewareDir, ["__proto__"], logger),
    ).rejects.toThrow('Middleware "__proto__" uses a reserved middleware name');
  });

  it("does not resolve inherited prototype keys as registered middleware", () => {
    const registry = {} as MiddlewareRegistry;

    expect(() => resolveMiddleware("__proto__", registry)).toThrow(
      'Middleware "__proto__" is not registered',
    );
    expect(() =>
      validateMiddlewareRefs(
        [
          {
            sourceFile: "src/routes/users.ts",
            routes: [
              {
                method: "GET",
                path: "/users",
                options: { middlewares: ["constructor"] },
              },
            ],
          },
        ],
        registry,
      ),
    ).toThrow('middleware "constructor" which is not registered');
  });

  it("loads TypeScript middleware without a host TypeScript loader", async () => {
    fs.writeFileSync(
      path.join(middlewareDir, "typed.ts"),
      `export default async function typed(_req: unknown, _res: unknown, next: () => Promise<void>): Promise<void> { await next(); }\n`,
    );

    const registry = await loadMiddlewares(middlewareDir, ["typed"], logger);

    expect(registry.typed?.kind).toBe("middleware");
    expect(typeof registry.typed?.handler).toBe("function");
    expect(
      fs
        .readdirSync(middlewareDir)
        .some((name) => name.includes(".__vext_compiled__")),
    ).toBe(false);
  });
});
