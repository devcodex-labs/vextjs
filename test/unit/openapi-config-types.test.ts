import { describe, expect, it } from "vitest";
import type { VextOpenAPITagGroup, VextUserConfig } from "../../src/index.js";

describe("VextOpenAPIConfig public types", () => {
  it("allows VextUserConfig consumers to configure openapi.tagGroups", () => {
    const tagGroups = [
      { name: "Public API", tags: ["Users", "Orders"] },
      { name: "Admin", tags: ["Admin"] },
    ] satisfies VextOpenAPITagGroup[];

    const config = {
      openapi: {
        tagGroups,
      },
    } satisfies VextUserConfig;

    expect(config.openapi.tagGroups[0]).toEqual({
      name: "Public API",
      tags: ["Users", "Orders"],
    });
  });
});
