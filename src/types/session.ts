import type { CookieSerializeOptions } from "./cookies.js";

export type VextSessionData = Record<string, unknown>;

export interface VextSessionStore {
  get(id: string): VextSessionData | null | Promise<VextSessionData | null>;
  set(
    id: string,
    data: VextSessionData,
    ttlSeconds: number,
  ): void | Promise<void>;
  delete(id: string): void | Promise<void>;
  touch?(id: string, ttlSeconds: number): void | Promise<void>;
  clearExpired?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface VextCacheLike {
  get<T = unknown>(key: string): T | undefined | Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs?: number): void | Promise<void>;
  del(key: string): boolean | void | Promise<boolean | void>;
}

export interface VextSessionStoreSerializer {
  serialize(data: VextSessionData): unknown;
  deserialize(value: unknown): VextSessionData;
}

export interface VextCacheSessionStoreOptions {
  prefix?: string;
  serializer?: VextSessionStoreSerializer;
  close?: () => void | Promise<void>;
}

export interface VextSessionCookieOptions extends Omit<
  CookieSerializeOptions,
  "secure"
> {
  secure?: boolean | "auto";
}

export interface VextSessionConfig {
  enabled?: boolean;
  name?: string;
  ttl?: number;
  rolling?: boolean;
  autoCommit?: boolean;
  idLength?: number;
  cookie?: VextSessionCookieOptions;
  store?: VextSessionStore;
}

export interface VextSession {
  readonly id: string;
  readonly isNew: boolean;
  readonly isDestroyed: boolean;
  save(): Promise<void>;
  regenerate(): Promise<void>;
  destroy(): Promise<void>;
  [key: string]: unknown;
}
