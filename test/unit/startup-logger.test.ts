import { describe, expect, it, vi } from "vitest";

import { quietStartupLogger } from "../../src/lib/startup-logger.js";

describe("startup logger", () => {
  it("restores the original level when startup quieting is still active", () => {
    let level = "info";
    const app = {
      logger: {
        getLevel: vi.fn(() => level),
        setLevel: vi.fn((next: string) => {
          level = next;
        }),
      },
    };

    const restore = quietStartupLogger(app as never, true);

    expect(level).toBe("warn");
    restore();

    expect(level).toBe("info");
  });

  it("does not overwrite a runtime level changed during bootstrap", () => {
    let level = "info";
    const app = {
      logger: {
        getLevel: vi.fn(() => level),
        setLevel: vi.fn((next: string) => {
          level = next;
        }),
      },
    };

    const restore = quietStartupLogger(app as never, true);
    level = "debug";
    restore();

    expect(level).toBe("debug");
    expect(app.logger.setLevel).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when startup quieting is disabled", () => {
    const app = {
      logger: {
        getLevel: vi.fn(() => "info"),
        setLevel: vi.fn(),
      },
    };

    const restore = quietStartupLogger(app as never, false);
    restore();

    expect(app.logger.setLevel).not.toHaveBeenCalled();
  });
});
