import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createHookManager } from "../../../src/lib/hooks.js";
import { generateOpenAPIDocumentWithHooks } from "../../../src/lib/openapi/hook-lifecycle.js";
import { OpenAPIGenerator } from "../../../src/lib/openapi/generator.js";
import type { VextApp } from "../../../src/types/app.js";

function readRepoFile(filePath: string): string {
  return readFileSync(resolve(filePath), "utf8");
}

describe("OpenAPI hook lifecycle", () => {
  it("emits before/after hooks and accepts a patched document", () => {
    const hooks = createHookManager();
    const before = vi.fn();
    hooks.on("openapi:beforeGenerate", before);
    hooks.on("openapi:afterGenerate", ({ document }) => ({
      document: {
        ...(document as Record<string, unknown>),
        info: {
          ...((document as { info: Record<string, unknown> }).info ?? {}),
          title: "Patched API",
        },
      },
    }));

    const app = { hooks } as VextApp;
    const generator = new OpenAPIGenerator({ title: "Original API" });
    const doc = generateOpenAPIDocumentWithHooks(app, generator, []);

    expect(before).toHaveBeenCalledWith({ routes: [] });
    expect(doc.info.title).toBe("Patched API");
  });

  it("logs and ignores async afterGenerate handlers at the sync lifecycle point", () => {
    const logger = {
      error: vi.fn(),
    };
    const hooks = createHookManager(logger as never);
    hooks.on("openapi:afterGenerate", (async () => ({
      document: {
        openapi: "3.0.3",
        info: { title: "Async Patch", version: "1.0.0" },
        paths: {},
      },
    })) as never);

    const app = { hooks } as VextApp;
    const generator = new OpenAPIGenerator({ title: "Original API" });
    const doc = generateOpenAPIDocumentWithHooks(app, generator, []);

    expect(doc.info.title).toBe("Original API");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ hook: "openapi:afterGenerate" }),
      expect.stringContaining('hook "openapi:afterGenerate" failed'),
    );
  });

  it("logs thrown afterGenerate handlers and keeps the generated document", () => {
    const logger = {
      error: vi.fn(),
    };
    const hooks = createHookManager(logger as never);
    hooks.on("openapi:afterGenerate", () => {
      throw new Error("patch failed");
    });

    const app = { hooks } as VextApp;
    const generator = new OpenAPIGenerator({ title: "Original API" });
    const doc = generateOpenAPIDocumentWithHooks(app, generator, []);

    expect(doc.info.title).toBe("Original API");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ hook: "openapi:afterGenerate" }),
      expect.stringContaining('hook "openapi:afterGenerate" failed'),
    );
  });

  it("documents OpenAPI generation hooks as synchronous patches", () => {
    const zhOpenapi = readRepoFile("website/docs/zh/guide/openapi.md");
    const enOpenapi = readRepoFile("website/docs/en/guide/openapi.md");
    const zhHooks = readRepoFile("website/docs/zh/guide/hooks.md");
    const enHooks = readRepoFile("website/docs/en/guide/hooks.md");

    expect(zhOpenapi).toContain("`openapi:afterGenerate` 也必须同步返回 patch");
    expect(enOpenapi).toContain(
      "`openapi:afterGenerate` must also return patches synchronously",
    );
    expect(zhHooks).toContain("同步生命周期，不允许返回 Promise");
    expect(enHooks).toContain(
      "Synchronous life cycle, return of Promise is not allowed",
    );
  });
});
