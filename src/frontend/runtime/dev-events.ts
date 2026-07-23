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
  replay?: boolean;
}

export interface VextFrontendDevEventBus {
  middleware: VextMiddleware;
  publish(event: VextFrontendDevEvent): void;
  close(): void;
  getClientCount(): number;
}

export const VEXT_FRONTEND_DEV_EVENT_PATH = "/__vext/dev/events";

function shouldReplayEvent(event: VextFrontendDevEvent): boolean {
  return event.type === "frontend:built" || event.type === "frontend:error";
}

function formatDevEventFrame(event: VextFrontendDevEvent): string {
  return `event: vext\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createFrontendDevEventBus(): VextFrontendDevEventBus {
  const clients = new Set<PassThrough>();
  let replayableEvent: VextFrontendDevEvent | undefined;
  const replayDelaysMs = [25, 150, 500];
  const publishRetryDelaysMs = [50, 200];

  const middleware: VextMiddleware = async (req, res, next) => {
    if (req.method !== "GET" || req.path !== VEXT_FRONTEND_DEV_EVENT_PATH) {
      await next();
      return;
    }

    const stream = new PassThrough();
    clients.add(stream);
    const replayTimers = replayableEvent
      ? replayDelaysMs.map((delayMs) =>
          setTimeout(() => {
            if (clients.has(stream) && replayableEvent) {
              stream.write(formatDevEventFrame({ ...replayableEvent, replay: true }));
            }
          }, delayMs),
        )
      : [];

    req.onClose(() => {
      for (const replayTimer of replayTimers) {
        clearTimeout(replayTimer);
      }
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

  const publishFrame = (event: VextFrontendDevEvent): void => {
    const frame = formatDevEventFrame(event);
    for (const client of clients) {
      client.write(frame);
    }
    if (!shouldReplayEvent(event)) {
      return;
    }
    for (const delayMs of publishRetryDelaysMs) {
      setTimeout(() => {
        const retryFrame = formatDevEventFrame({ ...event, replay: true });
        for (const client of clients) {
          client.write(retryFrame);
        }
      }, delayMs);
    }
  };

  return {
    middleware,
    publish(event) {
      if (shouldReplayEvent(event)) {
        replayableEvent = event;
      }
      publishFrame(event);
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
