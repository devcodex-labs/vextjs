import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMiddlewares } from "../../src/lib/middleware-loader.js";
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

    expect(registry).toEqual({});
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("rejects duplicate names before registry overwrite", async () => {
    await expect(
      loadMiddlewares(middlewareDir, ["auth", "auth"], logger),
    ).rejects.toThrow('Middleware "auth" is declared more than once');
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
