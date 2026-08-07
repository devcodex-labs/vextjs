import { describe, expect, it } from "vitest";
import {
  VextBrowserRuntime,
  type VextBrowserEnvironment,
} from "../../src/frontend/runtime/navigation.js";
import type { VextPageEnvelopeV1 } from "../../src/frontend/contract/page-envelope.js";

const mediaType = "application/vnd.vext.page+json;v=1";

describe("frontend browser navigation runtime", () => {
  it("deduplicates equivalent GET prefetches and records the complete cache identity", async () => {
    let calls = 0;
    const target = pageEnvelope("/next", "route-next", { title: "Next" });
    const environment = createEnvironment(async () => {
      calls++;
      await Promise.resolve();
      return envelopeResponse(target);
    });
    const runtime = new VextBrowserRuntime({
      buildId: "build-1",
      contractDigest: "contract-1",
      initialEnvelope: pageEnvelope("/", "route-home", { title: "Home" }),
      environment,
      render: () => undefined,
    });

    const [first, second] = await Promise.all([
      runtime.prefetch("/next"),
      runtime.prefetch("/next"),
    ]);

    expect(calls).toBe(1);
    expect(first).toEqual(target);
    expect(second).toEqual(target);
    expect(runtime.getDiagnostics().cacheKeys).toEqual([
      expect.stringMatching(
        /route=route-home\|url=\/\|locale=en-US\|partition=public\|protocol=1\|contract=contract-1/u,
      ),
      expect.stringMatching(
        /route=route-next\|url=\/next\|locale=en-US\|partition=public\|protocol=1\|contract=contract-1/u,
      ),
    ]);
    runtime.dispose();
  });

  it("keeps last-known-good route data when revalidation fails", async () => {
    const environment = createEnvironment(async () => {
      throw new Error("network down");
    });
    const runtime = new VextBrowserRuntime({
      buildId: "build-1",
      contractDigest: "contract-1",
      initialEnvelope: pageEnvelope("/", "route-home", { value: "old" }),
      environment,
      render: () => undefined,
    });

    await runtime.revalidate();

    expect(runtime.getRouteData()).toEqual({ value: "old" });
    expect(runtime.getSnapshot().phase).toBe("error");
    expect(runtime.getSnapshot().error?.message).toBe("network down");
    runtime.dispose();
  });

  it("aborts an older navigation and discards its late result", async () => {
    const rendered: string[] = [];
    const phases: string[] = [];
    let resolveFirst!: (response: Response) => void;
    const environment = createEnvironment((input, init) => {
      const url = String(input);
      if (url.endsWith("/one")) {
        return new Promise<Response>((resolve, reject) => {
          resolveFirst = resolve;
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return Promise.resolve(
        envelopeResponse(pageEnvelope("/two", "route-two", { value: 2 })),
      );
    });
    const runtime = new VextBrowserRuntime({
      buildId: "build-1",
      contractDigest: "contract-1",
      initialEnvelope: pageEnvelope("/", "route-home", { value: 0 }),
      environment,
      render: (envelope) => {
        rendered.push(envelope.url);
      },
    });
    runtime.subscribe(() => phases.push(runtime.getSnapshot().phase));

    const first = runtime.navigate("/one");
    const second = runtime.navigate("/two");
    resolveFirst(
      envelopeResponse(pageEnvelope("/one", "route-one", { value: 1 })),
    );
    await Promise.all([first, second]);

    expect(rendered).toEqual(["/two"]);
    expect(phases).toContain("aborted");
    expect(runtime.getRouteData()).toEqual({ value: 2 });
    expect(runtime.getSnapshot().phase).toBe("idle");
    runtime.dispose();
  });

  it("performs exactly one hard navigation for repeated protocol failures", async () => {
    const mismatched = pageEnvelope("/next", "route-next", { value: 1 });
    mismatched.buildId = "other-build";
    const environment = createEnvironment(async () =>
      envelopeResponse(mismatched),
    );
    const runtime = new VextBrowserRuntime({
      buildId: "build-1",
      contractDigest: "contract-1",
      initialEnvelope: pageEnvelope("/", "route-home", { value: 0 }),
      environment,
      render: () => undefined,
    });

    await runtime.navigate("/next");
    await runtime.navigate("/next?retry=1");

    expect(environment.assignments).toEqual(["https://app.test/next"]);
    expect(runtime.getDiagnostics().hardFallbackCount).toBe(1);
    expect(runtime.getRouteData()).toEqual({ value: 0 });
    runtime.dispose();
  });
});

function pageEnvelope(
  url: string,
  routeId: string,
  props: unknown,
): VextPageEnvelopeV1 {
  return {
    protocolVersion: 1,
    buildId: "build-1",
    routeId,
    url,
    result: {
      kind: "page",
      page: routeId.replace("route-", ""),
      props,
      layouts: [],
      head: {},
      assets: [],
    },
    cache: {
      contractDigest: "contract-1",
      partition: "public",
      tags: [],
      noStore: false,
    },
  };
}

function envelopeResponse(envelope: VextPageEnvelopeV1): Response {
  return new Response(JSON.stringify(envelope), {
    headers: { "content-type": `${mediaType}; charset=utf-8` },
  });
}

function createEnvironment(
  fetchImpl: typeof fetch,
): VextBrowserEnvironment & { assignments: string[] } {
  const assignments: string[] = [];
  const location = {
    href: "https://app.test/",
    origin: "https://app.test",
    pathname: "/",
    search: "",
    hash: "",
    assign(url: string) {
      assignments.push(url);
    },
    replace(url: string) {
      assignments.push(url);
    },
  };
  const history = {
    state: null as unknown,
    scrollRestoration: "auto",
    pushState(data: unknown, _unused: string, url?: string | URL | null) {
      this.state = data;
      if (url) updateLocation(location, String(url));
    },
    replaceState(data: unknown, _unused: string, url?: string | URL | null) {
      this.state = data;
      if (url) updateLocation(location, String(url));
    },
  };
  return {
    fetch: fetchImpl,
    location,
    history,
    navigator: { connection: { saveData: false, effectiveType: "4g" } },
    document: { title: "", documentElement: { lang: "en-US" } },
    scrollTo: () => undefined,
    assignments,
  };
}

function updateLocation(
  location: VextBrowserEnvironment["location"],
  input: string,
): void {
  const url = new URL(input, location.href);
  location.href = url.href;
  location.pathname = url.pathname;
  location.search = url.search;
  location.hash = url.hash;
}
