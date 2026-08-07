import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type FormEvent,
  type FormHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  VEXT_BUILD_ID_HEADER,
  VEXT_NAVIGATION_HEADER,
  VEXT_PAGE_MEDIA_TYPE,
  VEXT_PAGE_PROTOCOL_VERSION,
  isVextPageEnvelopeV1,
  type VextPageEnvelopeV1,
} from "../contract/page-envelope.js";

type VextBodyInit = RequestInit["body"];
type VextHeadersInit = ConstructorParameters<typeof Headers>[0];

export type VextNavigationPhase =
  | "idle"
  | "loading"
  | "submitting"
  | "revalidating"
  | "error"
  | "aborted";

export interface VextNavigationSnapshot {
  phase: VextNavigationPhase;
  sequence: number;
  url: string;
  method: string;
  error?: Error;
}

export interface VextNavigateOptions {
  replace?: boolean;
  preserveScroll?: boolean;
  input?: "keyboard" | "pointer" | "programmatic" | "popstate";
  state?: unknown;
}

export interface VextPrefetchOptions {
  signal?: AbortSignal;
  intent?: "click" | "visible" | "explicit";
}

export interface VextRevalidateTarget {
  routeId?: string;
  path?: string;
  tags?: string[];
  keys?: string[];
}

export interface VextSubmitOptions extends VextNavigateOptions {
  method?: string;
  body?: VextBodyInit | null;
  headers?: VextHeadersInit;
}

export interface VextFetcherSnapshot<T = unknown> {
  phase: VextNavigationPhase;
  data?: T;
  error?: Error;
}

export interface VextFetcher<T = unknown> extends VextFetcherSnapshot<T> {
  load(url: string): Promise<T | undefined>;
  submit(url: string, options?: VextSubmitOptions): Promise<T | undefined>;
}

export interface VextBrowserRuntimeDiagnostics {
  snapshot: VextNavigationSnapshot;
  cacheKeys: string[];
  inFlightKeys: string[];
  hardFallbackCount: number;
  currentEnvelope?: VextPageEnvelopeV1;
}

export interface ConfigureVextBrowserRuntimeOptions {
  buildId: string;
  contractDigest: string;
  initialEnvelope?: VextPageEnvelopeV1;
  render(envelope: VextPageEnvelopeV1): void | Promise<void>;
  environment?: VextBrowserEnvironment;
}

export interface VextBrowserEnvironment {
  fetch: typeof fetch;
  location: {
    href: string;
    origin: string;
    pathname: string;
    search: string;
    hash: string;
    assign(url: string): void;
    replace(url: string): void;
  };
  history: {
    state: unknown;
    scrollRestoration?: string;
    pushState(data: unknown, unused: string, url?: string | URL | null): void;
    replaceState(
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void;
  };
  navigator?: {
    connection?: {
      saveData?: boolean;
      effectiveType?: string;
    };
  };
  document?: VextBrowserDocument;
  addEventListener?(type: string, listener: (event: any) => void): void;
  removeEventListener?(type: string, listener: (event: any) => void): void;
  requestAnimationFrame?(callback: () => void): unknown;
  scrollTo?(x: number, y: number): void;
  readonly scrollX?: number;
  readonly scrollY?: number;
}

interface VextBrowserDocument {
  title: string;
  documentElement?: { lang?: string };
  head?: { appendChild(node: unknown): void };
  body?: { appendChild(node: unknown): void };
  createElement?(name: string): any;
  getElementById?(id: string): any;
  querySelector?(selector: string): any;
  querySelectorAll?(selector: string): ArrayLike<any>;
}

interface CacheEntry {
  envelope: VextPageEnvelopeV1;
  identityKey: string;
  requestKey: string;
  partition: string;
  tags: string[];
}

interface InFlightEntry {
  promise: Promise<VextPageEnvelopeV1>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}

interface FetchEnvelopeOptions {
  method?: string;
  body?: VextBodyInit | null;
  headers?: VextHeadersInit;
  signal?: AbortSignal;
  prefetch?: boolean;
  force?: boolean;
}

interface HistoryPayload {
  __vext: true;
  key: string;
  scrollX: number;
  scrollY: number;
  focusToken?: string;
  state?: unknown;
}

interface VextFormLike {
  enctype?: string;
  getAttribute(name: string): string | null;
}

interface VextSubmitterLike {
  getAttribute?(name: string): string | null;
}

const idleSnapshot: VextNavigationSnapshot = Object.freeze({
  phase: "idle",
  sequence: 0,
  url: "",
  method: "GET",
});
const idleFetcherSnapshot: VextFetcherSnapshot = Object.freeze({
  phase: "idle",
});

class VextProtocolFallbackError extends Error {
  override readonly name = "VextProtocolFallbackError";
}

export class VextPageResultError extends Error {
  override readonly name = "VextPageResultError";
  readonly status: number;
  readonly code?: string | number;
  readonly requestId?: string;

  constructor(envelope: VextPageEnvelopeV1) {
    const result = envelope.result;
    if (result.kind !== "error") {
      throw new Error("[vextjs/frontend] expected an error page envelope.");
    }
    super(result.message);
    this.status = result.status;
    this.code = result.code;
    this.requestId = result.requestId;
  }
}

export class VextBrowserRuntime {
  private readonly options: ConfigureVextBrowserRuntimeOptions;
  private readonly environment: VextBrowserEnvironment;
  private readonly subscribers = new Set<() => void>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlightEntry>();
  private readonly fetchers = new Map<string, VextFetcherSnapshot>();
  private readonly fetcherControllers = new Map<string, AbortController>();
  private readonly fetcherSequences = new Map<string, number>();
  private snapshot: VextNavigationSnapshot;
  private currentEnvelope: VextPageEnvelopeV1 | undefined;
  private navigationController: AbortController | undefined;
  private sequence = 0;
  private hardFallbackCount = 0;
  private hardFallbackStarted = false;
  private disposed = false;

  constructor(options: ConfigureVextBrowserRuntimeOptions) {
    this.options = options;
    this.environment = options.environment ?? resolveGlobalEnvironment();
    this.currentEnvelope = options.initialEnvelope;
    this.snapshot = {
      ...idleSnapshot,
      url: options.initialEnvelope?.url ?? this.environment.location.href,
    };
    if (options.initialEnvelope?.result.kind === "page") {
      this.storeEnvelope(options.initialEnvelope, this.snapshot.url);
    }
    this.bindHistory();
    this.ensureAnnouncementRegion();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  getSnapshot = (): VextNavigationSnapshot => this.snapshot;

  getRouteData<T = unknown>(): T | undefined {
    const result = this.currentEnvelope?.result;
    return (result?.kind === "page" ? result.props : undefined) as
      | T
      | undefined;
  }

  getDiagnostics(): VextBrowserRuntimeDiagnostics {
    return {
      snapshot: this.snapshot,
      cacheKeys: [...this.cache.values()].map((entry) => entry.identityKey),
      inFlightKeys: [...this.inFlight.keys()],
      hardFallbackCount: this.hardFallbackCount,
      currentEnvelope: this.currentEnvelope,
    };
  }

  async navigate(
    input: string | URL,
    options: VextNavigateOptions = {},
  ): Promise<void> {
    const url = this.resolveUrl(input);
    if (this.isHashOnlyNavigation(url)) {
      this.commitHistory(url, options);
      await this.restoreScrollAndFocus(url, options);
      return;
    }

    this.abortActiveNavigation();
    const sequence = ++this.sequence;
    const controller = new AbortController();
    this.navigationController = controller;
    this.setSnapshot({
      phase: "loading",
      sequence,
      url: url.href,
      method: "GET",
    });

    try {
      const envelope = await this.fetchEnvelope(url, {
        method: "GET",
        signal: controller.signal,
      });
      if (sequence !== this.sequence) return;
      await this.consumeEnvelope(envelope, url, options, sequence);
    } catch (error) {
      this.handleNavigationFailure(error, url, sequence);
    }
  }

  async prefetch(
    input: string | URL,
    options: VextPrefetchOptions = {},
  ): Promise<VextPageEnvelopeV1 | undefined> {
    const url = this.resolveUrl(input);
    if (!this.canPrefetch(url)) return undefined;
    try {
      return await this.fetchEnvelope(url, {
        method: "GET",
        signal: options.signal,
        prefetch: true,
      });
    } catch (error) {
      if (isAbortError(error)) return undefined;
      return undefined;
    }
  }

  async revalidate(target?: VextRevalidateTarget): Promise<void> {
    this.invalidate(target);
    const url = this.resolveUrl(
      this.currentEnvelope?.url ?? this.environment.location.href,
    );
    this.abortActiveNavigation();
    const sequence = ++this.sequence;
    const controller = new AbortController();
    this.navigationController = controller;
    this.setSnapshot({
      phase: "revalidating",
      sequence,
      url: url.href,
      method: "GET",
    });
    try {
      const envelope = await this.fetchEnvelope(url, {
        method: "GET",
        signal: controller.signal,
        force: true,
      });
      if (sequence !== this.sequence) return;
      await this.consumeEnvelope(
        envelope,
        url,
        { replace: true, preserveScroll: true, input: "programmatic" },
        sequence,
        true,
      );
    } catch (error) {
      this.handleNavigationFailure(error, url, sequence);
    }
  }

  async submit(
    input: string | URL,
    options: VextSubmitOptions = {},
  ): Promise<void> {
    const url = this.resolveUrl(input);
    const method = (options.method ?? "POST").toUpperCase();
    if (method === "GET") {
      await this.navigate(url, options);
      return;
    }

    this.abortActiveNavigation();
    const sequence = ++this.sequence;
    const controller = new AbortController();
    this.navigationController = controller;
    this.setSnapshot({
      phase: "submitting",
      sequence,
      url: url.href,
      method,
    });
    try {
      const envelope = await this.fetchEnvelope(url, {
        method,
        body: options.body,
        headers: options.headers,
        signal: controller.signal,
      });
      if (sequence !== this.sequence) return;
      await this.consumeEnvelope(envelope, url, options, sequence);
      if (envelope.result.kind === "page" && sequence === this.sequence) {
        await this.revalidate();
      }
    } catch (error) {
      this.handleNavigationFailure(error, url, sequence);
    }
  }

  async fetcherLoad<T = unknown>(
    id: string,
    input: string | URL,
  ): Promise<T | undefined> {
    return this.runFetcher<T>(id, input, { method: "GET" });
  }

  async fetcherSubmit<T = unknown>(
    id: string,
    input: string | URL,
    options: VextSubmitOptions = {},
  ): Promise<T | undefined> {
    const result = await this.runFetcher<T>(id, input, {
      method: (options.method ?? "POST").toUpperCase(),
      body: options.body,
      headers: options.headers,
    });
    if ((options.method ?? "POST").toUpperCase() !== "GET") {
      await this.revalidate();
    }
    return result;
  }

  getFetcherSnapshot<T = unknown>(id: string): VextFetcherSnapshot<T> {
    return (this.fetchers.get(id) ??
      idleFetcherSnapshot) as VextFetcherSnapshot<T>;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.navigationController?.abort();
    for (const entry of this.inFlight.values()) entry.controller.abort();
    this.environment.removeEventListener?.("popstate", this.onPopState);
    this.subscribers.clear();
  }

  private async runFetcher<T>(
    id: string,
    input: string | URL,
    request: FetchEnvelopeOptions,
  ): Promise<T | undefined> {
    const url = this.resolveUrl(input);
    const method = (request.method ?? "GET").toUpperCase();
    const sequence = (this.fetcherSequences.get(id) ?? 0) + 1;
    this.fetcherSequences.set(id, sequence);
    const previousController = this.fetcherControllers.get(id);
    if (previousController) {
      previousController.abort();
      this.setFetcher(id, {
        ...this.getFetcherSnapshot(id),
        phase: "aborted",
      });
    }
    const controller = new AbortController();
    this.fetcherControllers.set(id, controller);
    this.setFetcher(id, {
      ...this.getFetcherSnapshot(id),
      phase: method === "GET" ? "loading" : "submitting",
      error: undefined,
    });
    try {
      const envelope = await this.fetchEnvelope(url, {
        ...request,
        signal: controller.signal,
      });
      if (this.fetcherSequences.get(id) !== sequence) return undefined;
      if (envelope.result.kind === "redirect") {
        await this.navigate(envelope.result.location, {
          replace: envelope.result.replace,
        });
        this.setFetcher(id, { phase: "idle" });
        return undefined;
      }
      if (envelope.result.kind === "error") {
        throw new VextPageResultError(envelope);
      }
      const data = envelope.result.props as T;
      this.setFetcher(id, { phase: "idle", data });
      return data;
    } catch (error) {
      if (this.fetcherSequences.get(id) !== sequence) return undefined;
      if (isAbortError(error)) {
        this.setFetcher(id, { phase: "aborted" });
        return undefined;
      }
      const normalized = toError(error);
      this.setFetcher(id, {
        ...this.getFetcherSnapshot(id),
        phase: "error",
        error: normalized,
      });
      return undefined;
    } finally {
      if (this.fetcherSequences.get(id) === sequence) {
        this.fetcherControllers.delete(id);
      }
    }
  }

  private async fetchEnvelope(
    url: URL,
    options: FetchEnvelopeOptions,
  ): Promise<VextPageEnvelopeV1> {
    const method = (options.method ?? "GET").toUpperCase();
    const requestKey = this.createRequestKey(url, method);
    if (method === "GET" && !options.force) {
      const cached = this.cache.get(requestKey);
      if (cached) return cached.envelope;
      const shared = this.inFlight.get(requestKey);
      if (shared) return consumeInFlight(shared, options.signal);
    }

    const controller = new AbortController();
    if (method !== "GET") linkAbortSignal(options.signal, controller);
    const headers = new Headers(options.headers);
    headers.set("Accept", VEXT_PAGE_MEDIA_TYPE);
    headers.set(VEXT_NAVIGATION_HEADER, "1");
    headers.set(VEXT_BUILD_ID_HEADER, this.options.buildId);
    if (options.prefetch) headers.set("Vext-Prefetch", "1");

    const promise = (async () => {
      const response = await this.environment.fetch(url.href, {
        method,
        body: method === "GET" || method === "HEAD" ? undefined : options.body,
        headers,
        signal: controller.signal,
        credentials: "same-origin",
        redirect: "manual",
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith(VEXT_PAGE_MEDIA_TYPE)) {
        throw new VextProtocolFallbackError(
          `[vextjs/frontend] ${url.pathname} requires a document response.`,
        );
      }
      let value: unknown;
      try {
        value = JSON.parse(await response.text());
      } catch {
        throw new VextProtocolFallbackError(
          "[vextjs/frontend] failed to decode the page envelope.",
        );
      }
      if (!isVextPageEnvelopeV1(value)) {
        throw new VextProtocolFallbackError(
          "[vextjs/frontend] received an incompatible page envelope.",
        );
      }
      if (
        value.protocolVersion !== VEXT_PAGE_PROTOCOL_VERSION ||
        value.buildId !== this.options.buildId
      ) {
        throw new VextProtocolFallbackError(
          "[vextjs/frontend] page protocol or build id mismatch.",
        );
      }
      if (
        value.result.kind === "error" &&
        [401, 403].includes(value.result.status)
      ) {
        throw new VextProtocolFallbackError(
          "[vextjs/frontend] permission changed; document navigation is required.",
        );
      }
      if (
        method === "GET" &&
        value.result.kind === "page" &&
        !value.cache?.noStore &&
        !response.headers
          .get("cache-control")
          ?.toLowerCase()
          .includes("no-store")
      ) {
        this.storeEnvelope(value, url.href, requestKey);
      }
      return value;
    })();

    if (method === "GET") {
      const entry: InFlightEntry = {
        promise,
        controller,
        consumers: 0,
        settled: false,
      };
      this.inFlight.set(requestKey, entry);
      promise
        .finally(() => {
          entry.settled = true;
          if (this.inFlight.get(requestKey)?.promise === promise) {
            this.inFlight.delete(requestKey);
          }
        })
        .catch(() => undefined);
      return consumeInFlight(entry, options.signal);
    }
    return promise;
  }

  private async consumeEnvelope(
    envelope: VextPageEnvelopeV1,
    requestedUrl: URL,
    options: VextNavigateOptions,
    sequence: number,
    revalidation = false,
  ): Promise<void> {
    if (envelope.result.kind === "redirect") {
      await this.navigate(envelope.result.location, {
        ...options,
        replace: envelope.result.replace,
      });
      return;
    }
    if (envelope.result.kind === "error") {
      throw new VextPageResultError(envelope);
    }

    try {
      await this.loadAssets(envelope.result.assets);
    } catch {
      throw new VextProtocolFallbackError(
        "[vextjs/frontend] a route asset could not be loaded.",
      );
    }
    if (sequence !== this.sequence) return;
    const previousEnvelope = this.currentEnvelope;
    this.currentEnvelope = envelope;
    try {
      await this.options.render(envelope);
    } catch (error) {
      this.currentEnvelope = previousEnvelope;
      throw error;
    }
    if (sequence !== this.sequence) return;
    if (!revalidation) this.commitHistory(requestedUrl, options);
    await this.afterPaint();
    await this.restoreScrollAndFocus(requestedUrl, options, revalidation);
    this.announce(envelope);
    this.setSnapshot({
      phase: "idle",
      sequence,
      url: requestedUrl.href,
      method: "GET",
    });
  }

  private handleNavigationFailure(
    error: unknown,
    url: URL,
    sequence: number,
  ): void {
    if (sequence !== this.sequence) return;
    if (isAbortError(error)) {
      this.setSnapshot({
        phase: "aborted",
        sequence,
        url: url.href,
        method: this.snapshot.method,
      });
      return;
    }
    const normalized = toError(error);
    this.setSnapshot({
      phase: "error",
      sequence,
      url: url.href,
      method: this.snapshot.method,
      error: normalized,
    });
    if (error instanceof VextProtocolFallbackError) {
      this.hardNavigate(url.href, false);
    }
  }

  private abortActiveNavigation(): void {
    if (!this.navigationController) return;
    if (
      !["loading", "submitting", "revalidating"].includes(this.snapshot.phase)
    ) {
      return;
    }
    this.navigationController.abort();
    this.setSnapshot({
      ...this.snapshot,
      phase: "aborted",
    });
  }

  private hardNavigate(url: string, replace: boolean): void {
    if (this.hardFallbackStarted) return;
    this.hardFallbackStarted = true;
    this.hardFallbackCount++;
    if (replace) this.environment.location.replace(url);
    else this.environment.location.assign(url);
  }

  private invalidate(target?: VextRevalidateTarget): void {
    const currentPartition = this.currentPartition();
    for (const [key, entry] of this.cache) {
      if (entry.partition !== currentPartition) continue;
      const matches = target
        ? (target.routeId !== undefined &&
            entry.envelope.routeId === target.routeId) ||
          (target.path !== undefined &&
            new URL(entry.envelope.url, this.environment.location.origin)
              .pathname === target.path) ||
          (target.tags?.some((tag) => entry.tags.includes(tag)) ?? false) ||
          (target.keys?.includes(entry.identityKey) ?? false)
        : entry.envelope.url === this.currentEnvelope?.url;
      if (matches) this.cache.delete(key);
    }
  }

  private storeEnvelope(
    envelope: VextPageEnvelopeV1,
    requestedUrl: string,
    requestKey = this.createRequestKey(
      new URL(requestedUrl, this.environment.location.origin),
      "GET",
    ),
  ): void {
    if (envelope.result.kind !== "page" || envelope.cache?.noStore) return;
    const partition = envelope.cache?.partition ?? "public";
    const contractDigest =
      envelope.cache?.contractDigest ?? this.options.contractDigest;
    const normalized = normalizePathQuery(
      new URL(requestedUrl, this.environment.location.origin),
    );
    const locale = this.environment.document?.documentElement?.lang ?? "";
    const identityKey = [
      `route=${envelope.routeId}`,
      `url=${normalized}`,
      `locale=${locale}`,
      `partition=${partition}`,
      `protocol=${envelope.protocolVersion}`,
      `contract=${contractDigest}`,
    ].join("|");
    this.cache.set(requestKey, {
      envelope,
      identityKey,
      requestKey,
      partition,
      tags: envelope.cache?.tags ?? [],
    });
  }

  private createRequestKey(url: URL, method: string): string {
    return [
      method.toUpperCase(),
      normalizePathQuery(url),
      this.environment.document?.documentElement?.lang ?? "",
      this.currentPartition(),
      String(VEXT_PAGE_PROTOCOL_VERSION),
      this.options.contractDigest,
    ].join("|");
  }

  private currentPartition(): string {
    return this.currentEnvelope?.cache?.partition ?? "public";
  }

  private canPrefetch(url: URL): boolean {
    if (url.origin !== this.environment.location.origin) return false;
    const connection = this.environment.navigator?.connection;
    if (connection?.saveData) return false;
    if (["slow-2g", "2g"].includes(connection?.effectiveType ?? ""))
      return false;
    return true;
  }

  private resolveUrl(input: string | URL): URL {
    return new URL(String(input), this.environment.location.href);
  }

  private isHashOnlyNavigation(url: URL): boolean {
    const current = new URL(this.environment.location.href);
    return (
      current.origin === url.origin &&
      current.pathname === url.pathname &&
      current.search === url.search &&
      current.hash !== url.hash
    );
  }

  private commitHistory(url: URL, options: VextNavigateOptions): void {
    if (options.input === "popstate") return;
    this.saveCurrentScroll();
    const state: HistoryPayload = {
      __vext: true,
      key: createHistoryKey(),
      scrollX: 0,
      scrollY: 0,
      focusToken: options.input,
      state: options.state,
    };
    if (options.replace)
      this.environment.history.replaceState(state, "", url.href);
    else this.environment.history.pushState(state, "", url.href);
  }

  private saveCurrentScroll(): void {
    const current = isHistoryPayload(this.environment.history.state)
      ? this.environment.history.state
      : {
          __vext: true as const,
          key: createHistoryKey(),
          scrollX: 0,
          scrollY: 0,
        };
    this.environment.history.replaceState(
      {
        ...current,
        scrollX: this.environment.scrollX ?? 0,
        scrollY: this.environment.scrollY ?? 0,
      },
      "",
      this.environment.location.href,
    );
  }

  private bindHistory(): void {
    if (this.environment.history.scrollRestoration !== undefined) {
      this.environment.history.scrollRestoration = "manual";
    }
    this.environment.addEventListener?.("popstate", this.onPopState);
  }

  private readonly onPopState = (): void => {
    void this.navigate(this.environment.location.href, {
      replace: true,
      input: "popstate",
      preserveScroll: true,
    });
  };

  private async restoreScrollAndFocus(
    url: URL,
    options: VextNavigateOptions,
    revalidation = false,
  ): Promise<void> {
    if (revalidation) return;
    const historyState = this.environment.history.state;
    if (options.input === "popstate" && isHistoryPayload(historyState)) {
      this.environment.scrollTo?.(historyState.scrollX, historyState.scrollY);
    } else if (url.hash) {
      await this.scrollToAnchor(url.hash);
    } else if (!options.preserveScroll) {
      this.environment.scrollTo?.(0, 0);
    }

    if (options.input === "keyboard") {
      const document = this.environment.document;
      const target =
        document?.querySelector?.("main h1, [data-vext-route-heading], h1") ??
        document?.querySelector?.("[data-vext-root]");
      if (target) {
        if (!target.hasAttribute?.("tabindex"))
          target.setAttribute?.("tabindex", "-1");
        target.focus?.({ preventScroll: true });
      }
    }
  }

  private async scrollToAnchor(hash: string): Promise<void> {
    const id = decodeURIComponent(hash.slice(1));
    for (let attempt = 0; attempt < 4; attempt++) {
      const target = this.environment.document?.getElementById?.(id);
      if (target) {
        target.scrollIntoView?.();
        return;
      }
      await this.afterPaint();
    }
  }

  private async loadAssets(assets: string[]): Promise<void> {
    const document = this.environment.document;
    await Promise.all(
      [...new Set(assets)].map(async (asset) => {
        const url = new URL(asset, this.environment.location.origin);
        if (url.origin !== this.environment.location.origin) {
          throw new Error("cross-origin route asset");
        }
        const pathname = url.pathname.toLowerCase();
        if (pathname.endsWith(".css")) {
          if (
            document?.querySelector?.(
              `link[href="${escapeSelector(url.href)}"]`,
            )
          )
            return;
          const link = document?.createElement?.("link");
          if (!link || !document?.head) return;
          link.rel = "stylesheet";
          link.href = url.href;
          link.setAttribute?.("data-vext-route-asset", "");
          await new Promise<void>((resolve, reject) => {
            link.onload = () => resolve();
            link.onerror = () =>
              reject(new Error(`failed to load ${url.href}`));
            document.head?.appendChild(link);
          });
          return;
        }
        if (/\.(?:m?js)$/u.test(pathname)) {
          await import(/* @vite-ignore */ url.href);
        }
      }),
    );
  }

  private ensureAnnouncementRegion(): void {
    const document = this.environment.document;
    if (!document?.body || !document.createElement) return;
    if (document.getElementById?.("__vext_navigation_announcer__")) return;
    const region = document.createElement("div");
    region.id = "__vext_navigation_announcer__";
    region.setAttribute?.("role", "status");
    region.setAttribute?.("aria-live", "polite");
    region.setAttribute?.("aria-atomic", "true");
    region.style.cssText =
      "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
    document.body.appendChild(region);
  }

  private announce(envelope: VextPageEnvelopeV1): void {
    if (envelope.result.kind !== "page") return;
    const region = this.environment.document?.getElementById?.(
      "__vext_navigation_announcer__",
    );
    if (!region) return;
    const title =
      envelope.result.head.title ?? this.environment.document?.title;
    region.textContent = title
      ? `Navigated to ${title}`
      : `Navigated to ${envelope.result.page}`;
  }

  private afterPaint(): Promise<void> {
    return new Promise((resolve) => {
      const schedule = this.environment.requestAnimationFrame;
      if (!schedule) {
        queueMicrotask(resolve);
        return;
      }
      schedule(() => schedule(() => resolve()));
    });
  }

  private setSnapshot(snapshot: VextNavigationSnapshot): void {
    this.snapshot = Object.freeze(snapshot);
    this.emit();
  }

  private setFetcher(id: string, snapshot: VextFetcherSnapshot): void {
    this.fetchers.set(id, Object.freeze(snapshot));
    this.emit();
  }

  private emit(): void {
    for (const subscriber of this.subscribers) subscriber();
  }
}

let activeRuntime: VextBrowserRuntime | undefined;
let fetcherSequence = 0;

export function configureVextBrowserRuntime(
  options: ConfigureVextBrowserRuntimeOptions,
): VextBrowserRuntime {
  activeRuntime?.dispose();
  activeRuntime = new VextBrowserRuntime(options);
  const global = globalThis as typeof globalThis & {
    __VEXT_NAVIGATION__?: {
      getDiagnostics(): VextBrowserRuntimeDiagnostics;
      navigate: typeof navigate;
      prefetch: typeof prefetch;
      revalidate: typeof revalidate;
    };
  };
  global.__VEXT_NAVIGATION__ = {
    getDiagnostics: () =>
      activeRuntime?.getDiagnostics() ?? {
        snapshot: idleSnapshot,
        cacheKeys: [],
        inFlightKeys: [],
        hardFallbackCount: 0,
      },
    navigate,
    prefetch,
    revalidate,
  };
  return activeRuntime;
}

export function navigate(
  url: string | URL,
  options?: VextNavigateOptions,
): Promise<void> {
  return requireRuntime().navigate(url, options);
}

export function prefetch(
  url: string | URL,
  options?: VextPrefetchOptions,
): Promise<VextPageEnvelopeV1 | undefined> {
  return requireRuntime().prefetch(url, options);
}

export function revalidate(target?: VextRevalidateTarget): Promise<void> {
  return requireRuntime().revalidate(target);
}

export interface VextLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> {
  href: string;
  prefetch?: "click" | "visible" | "none";
  replace?: boolean;
  preserveScroll?: boolean;
  children?: ReactNode;
}

export function Link(props: VextLinkProps): ReactNode {
  const {
    href,
    prefetch: prefetchPolicy = "click",
    replace,
    preserveScroll,
    onClick,
    onPointerEnter,
    onFocus,
    children,
    ...rest
  } = props;
  const ref = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (prefetchPolicy !== "visible" || !ref.current) return;
    const IntersectionObserverCtor = (
      globalThis as typeof globalThis & { IntersectionObserver?: any }
    ).IntersectionObserver;
    if (!IntersectionObserverCtor) return;
    const controller = new AbortController();
    const observer = new IntersectionObserverCtor(
      (entries: Array<{ isIntersecting: boolean }>) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void activeRuntime?.prefetch(href, {
            signal: controller.signal,
            intent: "visible",
          });
        } else {
          controller.abort();
        }
      },
    );
    observer.observe(ref.current);
    return () => {
      controller.abort();
      observer.disconnect();
    };
  }, [href, prefetchPolicy]);

  const intentPrefetch = (): void => {
    if (prefetchPolicy === "click") {
      void activeRuntime?.prefetch(href, { intent: "click" });
    }
  };

  return createElement(
    "a",
    {
      ...rest,
      ref,
      href,
      onPointerEnter: (event: any) => {
        onPointerEnter?.(event);
        if (!event.defaultPrevented) intentPrefetch();
      },
      onFocus: (event: any) => {
        onFocus?.(event);
        if (!event.defaultPrevented) intentPrefetch();
      },
      onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          !shouldEnhanceLink(event, href, rest.target)
        )
          return;
        event.preventDefault();
        void activeRuntime?.navigate(href, {
          replace,
          preserveScroll,
          input: event.detail === 0 ? "keyboard" : "pointer",
        });
      },
    },
    children,
  );
}

export interface VextFormProps extends Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "action" | "method"
> {
  action?: string;
  method?: string;
  navigate?: boolean;
  replace?: boolean;
  preserveScroll?: boolean;
  children?: ReactNode;
}

export function Form(props: VextFormProps): ReactNode {
  const {
    action,
    method = "post",
    navigate: shouldNavigate = true,
    replace,
    preserveScroll,
    onSubmit,
    encType,
    children,
    ...rest
  } = props;
  return createElement(
    "form",
    {
      ...rest,
      action,
      method,
      encType,
      onSubmit: (event: FormEvent<HTMLFormElement>) => {
        onSubmit?.(event);
        if (event.defaultPrevented || !shouldNavigate || !activeRuntime) return;
        event.preventDefault();
        const form = event.currentTarget as unknown as VextFormLike;
        const submitter = (
          event.nativeEvent as { submitter?: VextSubmitterLike }
        ).submitter;
        const target =
          submitter?.getAttribute?.("formaction") ??
          action ??
          form.getAttribute("action") ??
          activeRuntime.getDiagnostics().snapshot.url;
        const finalMethod = (
          submitter?.getAttribute?.("formmethod") ??
          method ??
          form.getAttribute("method") ??
          "GET"
        ).toUpperCase();
        const FormDataCtor = FormData as unknown as new (
          form?: unknown,
          submitter?: unknown,
        ) => FormData;
        const data = new FormDataCtor(form, submitter);
        if (finalMethod === "GET") {
          const url = new URL(target, resolveGlobalEnvironment().location.href);
          for (const [key, value] of data.entries()) {
            if (typeof value === "string") url.searchParams.append(key, value);
          }
          void activeRuntime.navigate(url, {
            replace,
            preserveScroll,
            input: "programmatic",
          });
          return;
        }
        const multipart = (encType ?? form.enctype) === "multipart/form-data";
        const body = multipart ? data : formDataToSearchParams(data);
        void activeRuntime.submit(target, {
          method: finalMethod,
          body,
          headers: multipart
            ? undefined
            : {
                "Content-Type":
                  "application/x-www-form-urlencoded;charset=UTF-8",
              },
          replace,
          preserveScroll,
          input: "programmatic",
        });
      },
    },
    children,
  );
}

export function useNavigation(): VextNavigationSnapshot {
  return useSyncExternalStore(
    activeRuntime?.subscribe ?? subscribeNoop,
    activeRuntime?.getSnapshot ?? (() => idleSnapshot),
    () => idleSnapshot,
  );
}

export function useRouteData<T = unknown>(): T | undefined {
  useNavigation();
  return activeRuntime?.getRouteData<T>();
}

export function useFetcher<T = unknown>(): VextFetcher<T> {
  const idRef = useRef<string | undefined>(undefined);
  idRef.current ??= `fetcher-${++fetcherSequence}`;
  const id = idRef.current;
  const snapshot = useSyncExternalStore(
    activeRuntime?.subscribe ?? subscribeNoop,
    () => activeRuntime?.getFetcherSnapshot<T>(id) ?? idleFetcherSnapshot,
    () => idleFetcherSnapshot,
  ) as VextFetcherSnapshot<T>;
  const load = useCallback(
    (url: string) => requireRuntime().fetcherLoad<T>(id, url),
    [id],
  );
  const submit = useCallback(
    (url: string, options?: VextSubmitOptions) =>
      requireRuntime().fetcherSubmit<T>(id, url, options),
    [id],
  );
  return useMemo(
    () => ({ ...snapshot, load, submit }),
    [snapshot, load, submit],
  );
}

function requireRuntime(): VextBrowserRuntime {
  if (!activeRuntime) {
    throw new Error(
      "[vextjs/frontend] browser navigation runtime is not configured. Use the generated Vext browser entry.",
    );
  }
  return activeRuntime;
}

function subscribeNoop(): () => void {
  return () => undefined;
}

function shouldEnhanceLink(
  event: ReactMouseEvent<HTMLAnchorElement>,
  href: string,
  target: string | undefined,
): boolean {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }
  if (target && target !== "_self") return false;
  const environment = resolveGlobalEnvironment();
  const url = new URL(href, environment.location.href);
  return url.origin === environment.location.origin;
}

function resolveGlobalEnvironment(): VextBrowserEnvironment {
  const global = globalThis as typeof globalThis & Record<string, any>;
  const location = global.location;
  const history = global.history;
  if (!location || !history || typeof global.fetch !== "function") {
    throw new Error("[vextjs/frontend] browser Web APIs are not available.");
  }
  return {
    fetch: global.fetch.bind(global),
    location,
    history,
    navigator: global.navigator as VextBrowserEnvironment["navigator"],
    document: global.document,
    addEventListener: global.addEventListener?.bind(global),
    removeEventListener: global.removeEventListener?.bind(global),
    requestAnimationFrame: global.requestAnimationFrame?.bind(global),
    scrollTo: global.scrollTo?.bind(global),
    get scrollX() {
      return global.scrollX;
    },
    get scrollY() {
      return global.scrollY;
    },
  };
}

function normalizePathQuery(url: URL): string {
  const sorted = new URLSearchParams(url.searchParams);
  sorted.sort();
  const search = sorted.toString();
  return `${url.pathname}${search ? `?${search}` : ""}`;
}

function linkAbortSignal(
  signal: AbortSignal | undefined,
  controller: AbortController,
): void {
  if (!signal) return;
  if (signal.aborted) {
    controller.abort(signal.reason);
    return;
  }
  signal.addEventListener("abort", () => controller.abort(signal.reason), {
    once: true,
  });
}

function consumeInFlight(
  entry: InFlightEntry,
  signal: AbortSignal | undefined,
): Promise<VextPageEnvelopeV1> {
  entry.consumers++;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    entry.consumers--;
    if (!entry.settled && entry.consumers === 0) entry.controller.abort();
  };
  if (!signal) return entry.promise.finally(release);
  if (signal.aborted) {
    release();
    return Promise.reject(createAbortError(signal.reason));
  }
  return new Promise<VextPageEnvelopeV1>((resolve, reject) => {
    const onAbort = (): void => {
      release();
      reject(createAbortError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
      release();
    });
  });
}

function createAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new DOMException("Aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createHistoryKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isHistoryPayload(value: unknown): value is HistoryPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __vext?: unknown }).__vext === true
  );
}

function formDataToSearchParams(data: FormData): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (typeof value === "string") result.append(key, value);
  }
  return result;
}

function escapeSelector(value: string): string {
  return value.replace(/["\\]/gu, "\\$&");
}
