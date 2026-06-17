import { PassThrough } from "node:stream";
import type { VextMiddleware } from "../../types/middleware.js";

export interface VextFrontendDevEvent {
  type: "frontend:built" | "frontend:error" | "render:reload";
  action?: "fast-refresh" | "style" | "reload" | "prompt" | "auto" | "off";
  entry?: string;
  styles?: string[];
  buildId?: string;
  files?: string[];
  message?: string;
}

export interface VextFrontendDevEventBus {
  middleware: VextMiddleware;
  publish(event: VextFrontendDevEvent): void;
  close(): void;
  getClientCount(): number;
}

const DEV_EVENT_PATH = "/__vext/dev/events";

export function createFrontendDevEventBus(): VextFrontendDevEventBus {
  const clients = new Set<PassThrough>();

  const middleware: VextMiddleware = async (req, res, next) => {
    if (req.method !== "GET" || req.path !== DEV_EVENT_PATH) {
      await next();
      return;
    }

    const stream = new PassThrough();
    clients.add(stream);
    req.onClose(() => {
      clients.delete(stream);
      stream.end();
    });

    res
      .setHeader("Cache-Control", "no-store")
      .setHeader("Connection", "keep-alive")
      .setHeader("X-Accel-Buffering", "no")
      .stream(stream, "text/event-stream; charset=utf-8");

    stream.write("retry: 500\n\n");
  };

  return {
    middleware,
    publish(event) {
      const frame = `event: vext\ndata: ${JSON.stringify(event)}\n\n`;
      for (const client of clients) {
        client.write(frame);
      }
    },
    close() {
      for (const client of clients) {
        client.end();
      }
      clients.clear();
    },
    getClientCount() {
      return clients.size;
    },
  };
}
