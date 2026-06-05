import { describe, expect, it, vi } from "vitest";
import { createHookManager } from "../../../src/lib/hooks.js";
import { generateOpenAPIDocumentWithHooks } from "../../../src/lib/openapi/hook-lifecycle.js";
import { OpenAPIGenerator } from "../../../src/lib/openapi/generator.js";
import type { VextApp } from "../../../src/types/app.js";

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
});
