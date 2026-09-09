import { afterEach, describe, expect, it, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp } from "../../src/testing/index.js";
import { requestContext } from "../../src/lib/request-context.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("request metadata with request IDs disabled", () => {
  it("keeps concurrent locale and propagated header snapshots without generating IDs", async () => {
    const root = mkdtempSync(join(tmpdir(), "vext-metadata-"));
    roots.push(root);
    const generate = vi.fn(() => "must-not-run");
    const t = await createTestApp({
      rootDir: root,
      services: false,
      routes: false,
      middlewares: false,
      config: {
        requestId: { enabled: false, generate },
        locale: { default: "en-US", supported: ["en-US", "zh-CN"] },
        fetch: { propagateHeaders: ["x-tenant-id"] },
      },
    });
    t.app.adapter.registerRoute("GET", "/metadata", [
      async (req, res) => {
        await setImmediate();
        res.json({ ...requestContext.getStore(), requestId: req.requestId });
      },
    ]);
    try {
      const responses = await Promise.all([
        t.request
          .get("/metadata")
          .set("accept-language", "zh-CN")
          .set("x-tenant-id", "tenant-a"),
        t.request
          .get("/metadata")
          .set("accept-language", "en-US")
          .set("x-tenant-id", "tenant-b"),
        t.request.get("/metadata"),
      ]);
      expect(responses.map((response) => response.body.data.locale)).toEqual([
        "zh-CN",
        "en-US",
        "en-US",
      ]);
      expect(
        responses.map(
          (response) => response.body.data.propagatedHeaders?.["x-tenant-id"],
        ),
      ).toEqual(["tenant-a", "tenant-b", undefined]);
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.body.data.requestId).toBe("");
        expect(response.header("x-request-id")).toBeUndefined();
      }
      expect(generate).not.toHaveBeenCalled();
    } finally {
      await t.close();
    }
  });
});
