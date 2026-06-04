import type { Server, ServerOptions } from "node:http";
import type { VextServerConfig } from "../types/app.js";

const SERVER_CONFIG_KEYS: Array<keyof VextServerConfig> = [
  "requestTimeout",
  "headersTimeout",
  "keepAliveTimeout",
  "socketTimeout",
  "maxHeaderSize",
  "maxRequestsPerSocket",
  "connectionsCheckingInterval",
];

export function hasServerConfig(config?: VextServerConfig): boolean {
  return Boolean(
    config && SERVER_CONFIG_KEYS.some((key) => config[key] !== undefined),
  );
}

export function createNodeServerOptions(
  config?: VextServerConfig,
): ServerOptions {
  const options: ServerOptions = {};

  if (config?.requestTimeout !== undefined) {
    options.requestTimeout = config.requestTimeout;
  }
  if (config?.headersTimeout !== undefined) {
    options.headersTimeout = config.headersTimeout;
  }
  if (config?.keepAliveTimeout !== undefined) {
    options.keepAliveTimeout = config.keepAliveTimeout;
  }
  if (config?.maxHeaderSize !== undefined) {
    options.maxHeaderSize = config.maxHeaderSize;
  }
  if (config?.connectionsCheckingInterval !== undefined) {
    options.connectionsCheckingInterval = config.connectionsCheckingInterval;
  }

  return options;
}

export function applyServerConfig(
  server: Server,
  config?: VextServerConfig,
): void {
  if (!config) {
    return;
  }

  if (config.requestTimeout !== undefined) {
    server.requestTimeout = config.requestTimeout;
  }
  if (config.headersTimeout !== undefined) {
    server.headersTimeout = config.headersTimeout;
  }
  if (config.keepAliveTimeout !== undefined) {
    server.keepAliveTimeout = config.keepAliveTimeout;
  }
  if (config.socketTimeout !== undefined) {
    server.timeout = config.socketTimeout;
  }
  if (config.maxRequestsPerSocket !== undefined) {
    server.maxRequestsPerSocket = config.maxRequestsPerSocket;
  }
}
