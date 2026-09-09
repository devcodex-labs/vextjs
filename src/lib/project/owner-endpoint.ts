import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";

const WIRE_LIMIT = 16 * 1024;
const REQUEST_TIMEOUT = 1500;

export class ProjectOwnerError extends Error {
  constructor(
    public readonly code:
      | "VEXT_OWNER_BUSY"
      | "VEXT_OWNER_UNVERIFIED"
      | "VEXT_OWNER_CLOSED",
    message: string,
  ) {
    super(`[vextjs] ${code}: ${message}`);
    this.name = "ProjectOwnerError";
  }
}

export function ownerKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 这里只保存跨进程发现索引；项目产物与 MCP 配置仍留在项目根。 */
export function ownerRegistryDirectory(): string {
  return path.join(
    tmpdir(),
    `vextjs-owners-v1-${ownerKey(userInfo().username).slice(0, 16)}`,
  );
}

export function ownerEndpointPath(key: string): string {
  const name = `vext-owner-v1-${ownerKey(key)}`;
  if (process.platform === "win32") return `\\\\.\\pipe\\${name}`;
  if (process.platform === "linux") return `\0${name}`;
  const directory = ownerRegistryDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const endpoint = path.join(directory, `${ownerKey(key).slice(0, 24)}.sock`);
  if (Buffer.byteLength(endpoint) > 100) {
    throw new ProjectOwnerError(
      "VEXT_OWNER_UNVERIFIED",
      "IPC endpoint path exceeds the platform limit.",
    );
  }
  return endpoint;
}

export interface OwnerEndpoint {
  readonly path: string;
  readonly active: boolean;
  close(): Promise<void>;
}

/**
 * 端点是 OS 生命周期许可；JSON 文件不是锁。单连接单请求，限制大小与存活时间。
 * 不提供执行命令、杀进程或抢占功能；索引/项目语义由上层验证。
 */
export async function listenOwnerEndpoint(
  key: string,
  handle: (request: unknown, signal: AbortSignal) => unknown | Promise<unknown>,
): Promise<OwnerEndpoint> {
  const endpoint = ownerEndpointPath(key);
  const sockets = new Set<Socket>();
  let closing = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    const controller = new AbortController();
    let buffer = Buffer.alloc(0);
    let received = false;
    socket.setTimeout(REQUEST_TIMEOUT, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      controller.abort();
      sockets.delete(socket);
    });
    socket.on("data", (chunk: Buffer) => {
      if (received || closing || buffer.length + chunk.length > WIRE_LIMIT) {
        socket.destroy();
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf(10);
      if (end < 0) return;
      received = true;
      void (async () => {
        let nonce: string | undefined;
        try {
          const request = JSON.parse(buffer.subarray(0, end).toString("utf8"));
          if (typeof request?.nonce !== "string" || request.nonce.length !== 36)
            throw new Error("Invalid nonce");
          nonce = request.nonce;
          const value = await handle(request.value, controller.signal);
          const response = JSON.stringify({ nonce: request.nonce, value });
          if (
            !closing &&
            !controller.signal.aborted &&
            Buffer.byteLength(response) < WIRE_LIMIT
          )
            socket.end(`${response}\n`);
          else socket.destroy();
        } catch (error) {
          if (!nonce || closing || controller.signal.aborted) {
            socket.destroy();
            return;
          }
          const failure =
            error instanceof ProjectOwnerError
              ? error
              : new ProjectOwnerError(
                  "VEXT_OWNER_UNVERIFIED",
                  "Owner operation failed.",
                );
          const response = JSON.stringify({
            nonce,
            error: {
              code: failure.code,
              message: failure.message.slice(0, 1500),
            },
          });
          if (Buffer.byteLength(response) < WIRE_LIMIT)
            socket.end(`${response}\n`);
          else socket.destroy();
        }
      })();
    });
  });
  server.maxConnections = 16;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(
      {
        path: endpoint,
        exclusive: true,
        readableAll: false,
        writableAll: false,
      },
      () => {
        server.removeListener("error", onError);
        resolve();
      },
    );
  });
  // 许可不单独阻止一次性 CLI 退出，长运行服务由原有生命周期管理。
  server.unref();
  server.on("error", () => {
    closing = true;
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  let closed: Promise<void> | undefined;
  return {
    path: endpoint,
    get active() {
      return !closing && server.listening;
    },
    close() {
      if (!closed) {
        closing = true;
        for (const socket of sockets) socket.destroy();
        closed = new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
      return closed;
    },
  };
}

export async function requestOwnerEndpoint(
  key: string,
  value: unknown,
): Promise<unknown> {
  const nonce = randomUUID();
  const request = `${JSON.stringify({ nonce, value })}\n`;
  if (Buffer.byteLength(request) > WIRE_LIMIT)
    throw new ProjectOwnerError(
      "VEXT_OWNER_UNVERIFIED",
      "Owner request exceeds the size limit.",
    );
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: ownerEndpointPath(key) });
    let buffer = Buffer.alloc(0);
    let done = false;
    const finish = (error?: Error, result?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish(
          new ProjectOwnerError(
            "VEXT_OWNER_UNVERIFIED",
            "Owner handshake timed out.",
          ),
        ),
      REQUEST_TIMEOUT,
    );
    socket.once("error", (error) => finish(error));
    socket.once("connect", () => socket.write(request));
    socket.once("close", () => {
      if (!done)
        finish(
          new ProjectOwnerError(
            "VEXT_OWNER_UNVERIFIED",
            "Owner closed without a valid handshake.",
          ),
        );
    });
    socket.on("data", (chunk: Buffer) => {
      if (buffer.length + chunk.length > WIRE_LIMIT) {
        finish(
          new ProjectOwnerError(
            "VEXT_OWNER_UNVERIFIED",
            "Owner response exceeds the size limit.",
          ),
        );
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf(10);
      if (end < 0) return;
      try {
        const response = JSON.parse(buffer.subarray(0, end).toString("utf8"));
        if (response?.nonce !== nonce) throw new Error("Owner nonce mismatch");
        if (response.error) {
          const failure = response.error;
          if (
            ![
              "VEXT_OWNER_BUSY",
              "VEXT_OWNER_UNVERIFIED",
              "VEXT_OWNER_CLOSED",
            ].includes(failure.code) ||
            typeof failure.message !== "string"
          )
            throw new Error("Invalid owner error response");
          const prefix = `[vextjs] ${failure.code}: `;
          throw new ProjectOwnerError(
            failure.code,
            failure.message.startsWith(prefix)
              ? failure.message.slice(prefix.length)
              : failure.message,
          );
        }
        finish(undefined, response.value);
      } catch (error) {
        finish(
          error instanceof ProjectOwnerError
            ? error
            : new ProjectOwnerError("VEXT_OWNER_UNVERIFIED", String(error)),
        );
      }
    });
  });
}
