import { randomBytes } from "node:crypto";
import type { VextMiddleware } from "../types/middleware.js";
import type { VextRequest } from "../types/request.js";
import type { VextResponse } from "../types/response.js";
import type { CookieSerializeOptions } from "../types/cookies.js";
import type { VextHeaders } from "../types/headers.js";
import type {
  VextSession,
  VextSessionConfig,
  VextSessionCookieOptions,
  VextSessionData,
  VextSessionStore,
} from "../types/session.js";
import {
  appendSetCookie,
  serializeClearCookie,
  serializeCookie,
} from "./cookies.js";

export type {
  VextSession,
  VextSessionConfig,
  VextSessionCookieOptions,
  VextSessionData,
  VextSessionStore,
} from "../types/session.js";

const DEFAULT_SESSION_CONFIG: Required<
  Pick<
    VextSessionConfig,
    "enabled" | "name" | "ttl" | "rolling" | "autoCommit" | "idLength"
  >
> & { cookie: VextSessionCookieOptions } = {
  enabled: true,
  name: "vext.sid",
  ttl: 86400,
  rolling: false,
  autoCommit: true,
  idLength: 32,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: "auto",
  },
};

interface MemorySessionEntry {
  data: VextSessionData;
  expiresAt: number;
}

export interface VextMemorySessionStore extends VextSessionStore {
  size(): number;
}

export function createMemorySessionStore(): VextMemorySessionStore {
  const entries = new Map<string, MemorySessionEntry>();

  function now(): number {
    return Date.now();
  }

  function expiresIn(ttlSeconds: number): number {
    return now() + ttlSeconds * 1000;
  }

  function isExpired(entry: MemorySessionEntry): boolean {
    return entry.expiresAt <= now();
  }

  const store: VextMemorySessionStore = {
    get(id) {
      const entry = entries.get(id);
      if (!entry) return null;
      if (isExpired(entry)) {
        entries.delete(id);
        return null;
      }
      return { ...entry.data };
    },

    set(id, data, ttlSeconds) {
      entries.set(id, {
        data: { ...data },
        expiresAt: expiresIn(ttlSeconds),
      });
    },

    delete(id) {
      entries.delete(id);
    },

    touch(id, ttlSeconds) {
      const entry = entries.get(id);
      if (!entry) return;
      if (isExpired(entry)) {
        entries.delete(id);
        return;
      }
      entry.expiresAt = expiresIn(ttlSeconds);
    },

    clearExpired() {
      for (const [id, entry] of entries) {
        if (isExpired(entry)) entries.delete(id);
      }
    },

    size() {
      store.clearExpired?.();
      return entries.size;
    },
  };

  return store;
}

interface ResolvedSessionConfig {
  enabled: boolean;
  name: string;
  ttl: number;
  rolling: boolean;
  autoCommit: boolean;
  idLength: number;
  cookie: VextSessionCookieOptions;
  store: VextSessionStore;
}

interface SessionState {
  id: string;
  isNew: boolean;
  destroyed: boolean;
  dirty: boolean;
  saved: boolean;
  clearWritten: boolean;
  target: Record<string, unknown>;
  pendingCommit?: Promise<void>;
  proxy?: VextSession;
}

const RESERVED_SESSION_KEYS = new Set([
  "id",
  "isNew",
  "isDestroyed",
  "save",
  "regenerate",
  "destroy",
]);

export function createSessionMiddleware(
  options: VextSessionConfig = {},
): VextMiddleware {
  const middlewareStore = options.store ?? createMemorySessionStore();

  return async (req, res, next) => {
    const config = resolveSessionConfig(
      req.app.config.session,
      options,
      middlewareStore,
    );

    if (!config.enabled) {
      await next();
      return;
    }

    assertSessionConfig(config);

    const state = await createSessionState(req, config);
    req.session = createSessionProxy(req, res, config, state);
    let committedOnSend = false;
    const previousOnSend = res._onSend;

    res._onSend = (data, statusCode, headers = {}) => {
      if (config.autoCommit) {
        commitSessionForSend(req, res, config, state, {
          force: config.rolling,
          headers,
        });
        committedOnSend = true;
      }
      previousOnSend?.(data, statusCode, headers);
    };

    await next();

    if (config.autoCommit && committedOnSend) {
      await state.pendingCommit;
    } else if (config.autoCommit) {
      await commitSession(req, res, config, state, { force: config.rolling });
    }
  };
}

export const session = createSessionMiddleware;

async function createSessionState(
  req: VextRequest,
  config: ResolvedSessionConfig,
): Promise<SessionState> {
  const incomingId = req.cookie(config.name);
  if (incomingId) {
    const stored = await config.store.get(incomingId);
    if (stored) {
      return {
        id: incomingId,
        isNew: false,
        destroyed: false,
        dirty: false,
        saved: false,
        clearWritten: false,
        target: { ...stored },
      };
    }
  }

  return {
    id: generateSessionId(config.idLength),
    isNew: true,
    destroyed: false,
    dirty: false,
    saved: false,
    clearWritten: false,
    target: {},
  };
}

function createSessionProxy(
  req: VextRequest,
  res: VextResponse,
  config: ResolvedSessionConfig,
  state: SessionState,
): VextSession {
  const methods = {
    save: async () => {
      await commitSession(req, res, config, state, { force: true });
    },
    regenerate: async () => {
      if (!state.destroyed) {
        await config.store.delete(state.id);
      }
      state.id = generateSessionId(config.idLength);
      state.isNew = true;
      state.destroyed = false;
      state.dirty = true;
      state.saved = false;
      state.clearWritten = false;
    },
    destroy: async () => {
      if (!state.destroyed) {
        await config.store.delete(state.id);
      }
      state.destroyed = true;
      state.dirty = false;
      state.saved = false;
      writeClearCookie(req, res, config, state);
    },
  };

  Object.defineProperties(state.target, {
    id: {
      enumerable: false,
      get: () => state.id,
    },
    isNew: {
      enumerable: false,
      get: () => state.isNew,
    },
    isDestroyed: {
      enumerable: false,
      get: () => state.destroyed,
    },
    save: {
      enumerable: false,
      value: methods.save,
    },
    regenerate: {
      enumerable: false,
      value: methods.regenerate,
    },
    destroy: {
      enumerable: false,
      value: methods.destroy,
    },
  });

  state.proxy = new Proxy(state.target, {
    set(target, property, value) {
      if (typeof property === "string" && RESERVED_SESSION_KEYS.has(property)) {
        return false;
      }
      state.dirty = true;
      state.saved = false;
      return Reflect.set(target, property, value);
    },

    deleteProperty(target, property) {
      if (typeof property === "string" && RESERVED_SESSION_KEYS.has(property)) {
        return false;
      }
      state.dirty = true;
      state.saved = false;
      return Reflect.deleteProperty(target, property);
    },
  }) as VextSession;

  return state.proxy;
}

async function commitSession(
  req: VextRequest,
  res: VextResponse,
  config: ResolvedSessionConfig,
  state: SessionState,
  options: { force: boolean },
): Promise<void> {
  if (state.destroyed) {
    writeClearCookie(req, res, config, state);
    return;
  }

  if (state.saved && !state.dirty) {
    return;
  }

  if (!state.dirty && !options.force) {
    return;
  }

  const data = extractSessionData(state.target);
  if (!state.dirty && options.force && !state.isNew && config.store.touch) {
    await config.store.touch(state.id, config.ttl);
  } else {
    await config.store.set(state.id, data, config.ttl);
  }

  writeSessionCookie(req, res, config, state);
  state.isNew = false;
  state.dirty = false;
  state.saved = true;
}

function commitSessionForSend(
  req: VextRequest,
  res: VextResponse,
  config: ResolvedSessionConfig,
  state: SessionState,
  options: { force: boolean; headers: VextHeaders },
): void {
  if (state.destroyed) {
    writeClearCookie(req, res, config, state, options.headers);
    return;
  }

  if (state.saved && !state.dirty) {
    return;
  }

  if (!state.dirty && !options.force) {
    return;
  }

  const data = extractSessionData(state.target);
  const commit =
    !state.dirty && options.force && !state.isNew && config.store.touch
      ? config.store.touch(state.id, config.ttl)
      : config.store.set(state.id, data, config.ttl);

  state.pendingCommit = Promise.resolve(commit).then(() => undefined);
  writeSessionCookie(req, res, config, state, options.headers);
  state.isNew = false;
  state.dirty = false;
  state.saved = true;
}

function extractSessionData(target: Record<string, unknown>): VextSessionData {
  const data: VextSessionData = {};
  for (const [key, value] of Object.entries(target)) {
    if (!RESERVED_SESSION_KEYS.has(key)) data[key] = value;
  }
  return data;
}

function writeClearCookie(
  req: VextRequest,
  res: VextResponse,
  config: ResolvedSessionConfig,
  state: SessionState,
  headers?: VextHeaders,
): void {
  if (state.clearWritten) return;
  const options = resolveCookieOptions(req, config);
  res.clearCookie(config.name, options);
  if (headers) {
    appendSetCookie(headers, serializeClearCookie(config.name, options));
  }
  state.clearWritten = true;
}

function writeSessionCookie(
  req: VextRequest,
  res: VextResponse,
  config: ResolvedSessionConfig,
  state: SessionState,
  headers?: VextHeaders,
): void {
  const options = resolveCookieOptions(req, config);
  res.cookie(config.name, state.id, options);
  if (headers) {
    appendSetCookie(headers, serializeCookie(config.name, state.id, options));
  }
}

function resolveSessionConfig(
  appConfig: VextSessionConfig | undefined,
  options: VextSessionConfig,
  fallbackStore: VextSessionStore,
): ResolvedSessionConfig {
  const merged: VextSessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    ...(appConfig ?? {}),
    ...options,
    cookie: {
      ...DEFAULT_SESSION_CONFIG.cookie,
      ...(appConfig?.cookie ?? {}),
      ...(options.cookie ?? {}),
    },
  };

  return {
    enabled: merged.enabled ?? DEFAULT_SESSION_CONFIG.enabled,
    name: merged.name ?? DEFAULT_SESSION_CONFIG.name,
    ttl: merged.ttl ?? DEFAULT_SESSION_CONFIG.ttl,
    rolling: merged.rolling ?? DEFAULT_SESSION_CONFIG.rolling,
    autoCommit: merged.autoCommit ?? DEFAULT_SESSION_CONFIG.autoCommit,
    idLength: merged.idLength ?? DEFAULT_SESSION_CONFIG.idLength,
    cookie: merged.cookie ?? DEFAULT_SESSION_CONFIG.cookie,
    store: options.store ?? appConfig?.store ?? fallbackStore,
  };
}

function resolveCookieOptions(
  req: VextRequest,
  config: ResolvedSessionConfig,
): CookieSerializeOptions {
  const { secure, maxAge, ...rest } = config.cookie;
  return {
    ...rest,
    maxAge: maxAge ?? config.ttl,
    secure: secure === "auto" ? req.protocol === "https" : secure,
  };
}

function generateSessionId(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

function assertSessionConfig(config: ResolvedSessionConfig): void {
  if (!config.name) {
    throw new Error("[vextjs] session.name must not be empty");
  }
  if (!Number.isFinite(config.ttl) || config.ttl <= 0) {
    throw new Error(
      "[vextjs] session.ttl must be a positive number of seconds",
    );
  }
  if (
    !Number.isInteger(config.idLength) ||
    config.idLength < 16 ||
    config.idLength > 128
  ) {
    throw new Error(
      "[vextjs] session.idLength must be an integer from 16 to 128",
    );
  }
}
