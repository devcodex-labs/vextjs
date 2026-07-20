import { describe, expect, it } from "vitest";
import type { VextHookHandler } from "../../../src/types/hooks.js";

type OpenAPIAfterGenerateHook = VextHookHandler<"openapi:afterGenerate">;

const syncOpenAPIAfterGenerateHook: OpenAPIAfterGenerateHook = () => ({
  document: {
    openapi: "3.0.3",
    info: { title: "Patched API", version: "1.0.0" },
    paths: {},
  },
});

// @ts-expect-error OpenAPI generation hooks are synchronous; async patches are ignored at runtime.
const asyncOpenAPIAfterGenerateHook: OpenAPIAfterGenerateHook = async () => ({
  document: {
    openapi: "3.0.3",
    info: { title: "Async Patch", version: "1.0.0" },
    paths: {},
  },
});

const asyncRequestStartHook: VextHookHandler<"request:start"> = async () => {
  return undefined;
};

describe("OpenAPI hook lifecycle type contracts", () => {
  it("keeps sync OpenAPI hooks and async safe hooks representable at runtime", () => {
    expect(typeof syncOpenAPIAfterGenerateHook).toBe("function");
    expect(typeof asyncOpenAPIAfterGenerateHook).toBe("function");
    expect(typeof asyncRequestStartHook).toBe("function");
  });
});
