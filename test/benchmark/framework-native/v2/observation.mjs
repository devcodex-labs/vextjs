/**
 * Conformance-only instrumentation. Measurement entrypoints must never import
 * this module; all wrappers are constructed only by the conformance harness.
 */
export class ConformanceObserver {
  #events = [];

  record(kind, detail = {}) {
    this.#events.push({ kind, ...detail });
  }

  reset() {
    this.#events = [];
  }

  snapshot() {
    const counts = {};
    for (const event of this.#events) {
      counts[event.kind] = (counts[event.kind] ?? 0) + 1;
    }
    return { counts, events: this.#events.map((event) => ({ ...event })) };
  }

  observeLogLine(line) {
    try {
      const parsed = JSON.parse(String(line));
      const requestId = parsed.requestId ?? parsed.reqId;
      const summary =
        /^(?<method>[A-Z]+)\s+(?<path>\S+)\s+(?<statusCode>\d{3})\s+/u.exec(
          String(parsed.msg ?? ""),
        )?.groups;
      const statusCode =
        parsed.statusCode ?? parsed.res?.statusCode ?? summary?.statusCode;
      const method = parsed.method ?? parsed.req?.method ?? summary?.method;
      const path =
        parsed.path ?? parsed.url ?? parsed.req?.url ?? summary?.path;
      if (requestId && statusCode && method && path) {
        this.record("accessLog", {
          requestId: String(requestId),
          statusCode: Number(statusCode),
          method: String(method),
          path: String(path),
        });
      }
    } catch {
      // Startup and framework diagnostics are intentionally not access events.
    }
  }
}

export function observeRepository(repository, observer) {
  return {
    async readUser(userId) {
      observer.record("repositoryRead", { userId: String(userId) });
      return repository.readUser(userId);
    },
    async writeOrder(order) {
      observer.record("repositoryWrite", { sku: order.sku });
      return repository.writeOrder(order);
    },
  };
}

export function observeQuoteClient(quoteClient, observer) {
  return {
    async quote(context, body) {
      observer.record("quote", {
        requestId: context.requestId,
        sku: body.sku,
      });
      return quoteClient.quote(context, body);
    },
  };
}

export function createObservingLogStream(observer) {
  let pending = "";
  return {
    write(chunk) {
      pending += String(chunk);
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? "";
      for (const line of lines) observer.observeLogLine(line);
      return true;
    },
  };
}

export function assertObservedSideEffects(
  observerSnapshot,
  { requestId, expected, expectedStatus },
) {
  const events = observerSnapshot.events.filter(
    (event) => event.requestId === requestId || !event.requestId,
  );
  const count = (kind) => events.filter((event) => event.kind === kind).length;
  const actual = {
    reads: count("repositoryRead"),
    writes: count("repositoryWrite"),
    quoteCalls: count("quote"),
    accessLogs: events.filter(
      (event) => event.kind === "accessLog" && event.requestId === requestId,
    ).length,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(
        `Conformance side-effect mismatch for ${requestId}: ${key} expected ${value}, received ${actual[key]}`,
      );
    }
  }
  if (actual.accessLogs !== 1) {
    throw new Error(
      `Conformance access log mismatch for ${requestId}: expected 1, received ${actual.accessLogs}`,
    );
  }
  const access = events.find(
    (event) => event.kind === "accessLog" && event.requestId === requestId,
  );
  if (
    !access ||
    access.statusCode !== expectedStatus ||
    !access.method ||
    !access.path
  ) {
    throw new Error(
      `Conformance access log projection failed for ${requestId}`,
    );
  }
  return actual;
}
