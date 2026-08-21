import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRouteFreshnessIdentity } from "../../src/frontend/contract/schema-ir.js";
import {
  VextFrontendFreshnessStore,
  createFreshnessKeyDigest,
} from "../../src/frontend/runtime/freshness.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("RouteOptions.frontend freshness identity", () => {
  it("keeps unconfigured routes byte-for-byte compatible with legacy dynamic identity", () => {
    expect(createRouteFreshnessIdentity()).toEqual({
      mode: "dynamic",
      source: "legacy-default",
    });
  });

  it("normalizes static parameters, tags, and bounded budgets from the existing route option", () => {
    expect(
      createRouteFreshnessIdentity({
        frontend: {
          mode: "static",
          staticParams: [{ slug: "hello", page: 2, preview: false }],
          tags: ["news", "news", "home"],
          page: "posts/detail",
          clientOnly: true,
          staticBudget: { maxParams: 4, maxBytes: 8_192 },
        },
      }),
    ).toEqual({
      mode: "static",
      source: "route-options",
      staticParams: [{ page: "2", preview: "false", slug: "hello" }],
      tags: ["home", "news"],
      page: "posts/detail",
      clientOnly: true,
      staticBudget: { maxParams: 4, maxBytes: 8_192 },
    });
  });

  it("rejects contradictory static/revalidate declarations before server startup", () => {
    expect(() =>
      createRouteFreshnessIdentity({
        frontend: { mode: "static", revalidate: 5 },
      }),
    ).toThrow("revalidate is only valid");
    expect(() =>
      createRouteFreshnessIdentity({
        frontend: { mode: "revalidate", revalidate: 1, staticParams: [{}] },
      }),
    ).toThrow("staticParams is only valid");
  });

  it("includes no-hydration and normalized SEO in route identity without changing the legacy default", () => {
    expect(
      createRouteFreshnessIdentity({
        frontend: {
          hydration: "none",
          seo: {
            title: "  Article  ",
            canonical: "/posts/hello",
            originKey: "docs",
            robots: ["index", "follow"],
          },
        },
      }),
    ).toEqual({
      mode: "dynamic",
      source: "route-options",
      hydration: "none",
      seo: {
        title: "Article",
        robots: ["index", "follow"],
        canonical: "/posts/hello",
        originKey: "docs",
      },
    });

    expect(() =>
      createRouteFreshnessIdentity({
        frontend: { hydration: "none", clientOnly: true },
      }),
    ).toThrow("cannot be combined with clientOnly");
    expect(() =>
      createRouteFreshnessIdentity({
        frontend: { seo: { canonical: "https://example.com/post" } },
      }),
    ).toThrow("absolute pathname");
  });
});

describe("VextFrontendFreshnessStore", () => {
  it("persists fresh and stale last-known-good entries across store instances", async () => {
    const rootDir = await tempRoot();
    const store = new VextFrontendFreshnessStore(rootDir);
    const key = createKey("build-a");
    await store.write({
      key,
      tags: ["news"],
      response: response("first"),
    });

    await expect(store.read(key)).resolves.toMatchObject({
      state: "fresh",
      entry: { response: { payload: "first" } },
    });
    await expect(
      new VextFrontendFreshnessStore(rootDir).read(key),
    ).resolves.toMatchObject({
      state: "fresh",
      entry: { keyDigest: createFreshnessKeyDigest(key) },
    });

    await store.write({
      key,
      tags: ["news"],
      ttlMs: 0,
      response: response("replacement"),
    });
    await expect(store.read(key)).resolves.toMatchObject({
      state: "stale",
      entry: { response: { payload: "replacement" } },
    });
  });

  it("deduplicates concurrent producers and reports observable invalidation results", async () => {
    const rootDir = await tempRoot();
    const store = new VextFrontendFreshnessStore(rootDir);
    const key = createKey("build-b");
    let executions = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        store.singleFlight(key, async () => {
          executions += 1;
          await Promise.resolve();
          return store.write({
            key,
            tags: ["posts"],
            response: response("single-flight"),
          });
        }),
      ),
    );

    expect(executions).toBe(1);
    expect(results.filter((result) => result.leader)).toHaveLength(1);
    const invalidation = await store.invalidate({ tag: "posts" });
    expect(invalidation).toEqual({
      matched: [createFreshnessKeyDigest(key)],
      removed: [createFreshnessKeyDigest(key)],
    });
    await expect(store.read(key)).resolves.toEqual({ state: "miss" });
  });

  it("requires a scoped invalidation selector", async () => {
    const store = new VextFrontendFreshnessStore(await tempRoot());
    await expect(store.invalidate({})).rejects.toThrow(
      "invalidation requires route, path, tag, key, locale, or partition",
    );
  });
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vext-freshness-"));
  tempDirs.push(directory);
  return directory;
}

function createKey(buildId: string) {
  return {
    route: "/posts/:slug",
    path: "/posts/hello",
    query: {},
    locale: "zh-CN",
    buildId,
    partition: "public",
    policy: { mode: "revalidate" as const, revalidate: 30 },
  };
}

function response(payload: string) {
  return { payload, status: 200, headers: { "Content-Type": "text/html" } };
}
