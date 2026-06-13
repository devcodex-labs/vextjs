import { describe, expect, it, vi } from "vitest";
import { createApp, DEFAULT_CONFIG } from "../../src/lib/app.js";

describe("createApp", () => {
  it("allows plugins to add new app extension properties", () => {
    const { app } = createApp(DEFAULT_CONFIG);

    app.extend("mailer", { send: () => undefined });

    expect((app as unknown as { mailer: unknown }).mailer).toBeDefined();
  });

  it("prevents app extensions from overriding built-in properties", () => {
    const { app } = createApp(DEFAULT_CONFIG);

    expect(() => app.extend("cache", {})).toThrow(
      '[vextjs] app.extend("cache") cannot override an existing app property.',
    );
  });

  it("normalizes partial logger wrappers installed through setLogger", () => {
    const { app } = createApp(DEFAULT_CONFIG);
    const info = vi.fn();

    app.setLogger(() => ({ info }));

    expect(typeof app.logger.trace).toBe("function");
    expect(typeof app.logger.getLevel).toBe("function");
    expect(typeof app.logger.setLevel).toBe("function");
    expect(typeof app.logger.child).toBe("function");

    app.logger.info("wrapped info");
    expect(info).toHaveBeenCalledWith("wrapped info");

    app.logger.setLevel("trace");
    expect(app.logger.getLevel()).toBe("trace");
    expect(app.logger.child({ service: "child" }).getLevel()).toBe("trace");
  });
});
