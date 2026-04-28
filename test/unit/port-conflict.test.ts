import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import {
  normalizePortConflictStrategy,
  resolvePortConflict,
} from "../../src/lib/port-conflict.js";

async function listenRandomPort(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve random test port.");
  }

  return { server, port: address.port };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (
        error &&
        (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
      ) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

describe("port-conflict", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()!;
      await closeServer(server);
    }
  });

  it("normalizes invalid strategy to error", () => {
    expect(normalizePortConflictStrategy(undefined)).toBe("error");
    expect(normalizePortConflictStrategy("unexpected")).toBe("error");
    expect(normalizePortConflictStrategy("next")).toBe("next");
  });

  it("returns unchanged port when target port is free", async () => {
    const resolution = await resolvePortConflict({
      host: "127.0.0.1",
      port: 43219,
      strategy: "error",
    });

    expect(resolution.port).toBe(43219);
    expect(resolution.changed).toBe(false);
    expect(resolution.action).toBe("none");
  });

  it("throws on occupied port when strategy=error", async () => {
    const { server, port } = await listenRandomPort();
    servers.push(server);

    await expect(
      resolvePortConflict({
        host: "127.0.0.1",
        port,
        strategy: "error",
      }),
    ).rejects.toThrow(`Port ${port} is already in use`);
  });

  it("selects next available port when strategy=next", async () => {
    const { server, port } = await listenRandomPort();
    servers.push(server);

    const resolution = await resolvePortConflict({
      host: "127.0.0.1",
      port,
      strategy: "next",
    });

    expect(resolution.changed).toBe(true);
    expect(resolution.port).toBeGreaterThan(port);
    expect(resolution.action).toBe("next");
  });

  it("supports prompt decision=next", async () => {
    const { server, port } = await listenRandomPort();
    servers.push(server);

    const resolution = await resolvePortConflict({
      host: "127.0.0.1",
      port,
      strategy: "prompt",
      interactive: true,
      requestDecision: async () => "next",
    });

    expect(resolution.changed).toBe(true);
    expect(resolution.action).toBe("next");
    expect(resolution.port).toBeGreaterThan(port);
  });

  it("supports prompt decision=retry after port becomes free", async () => {
    const { server, port } = await listenRandomPort();
    servers.push(server);

    setTimeout(() => {
      closeServer(server).catch(() => undefined);
    }, 50);

    const resolution = await resolvePortConflict({
      host: "127.0.0.1",
      port,
      strategy: "prompt",
      interactive: true,
      requestDecision: async () => "retry",
    });

    expect(resolution.changed).toBe(false);
    expect(resolution.port).toBe(port);
  });
});



