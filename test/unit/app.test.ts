import { describe, expect, it } from "vitest";
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
});
