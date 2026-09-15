import { describe, expect, it } from "vitest";
import { paginateAssistantItems } from "../../../src/assistant/pagination.js";

describe("MCP source collection cursors", () => {
  it("keeps the original total and resumes without duplicates", () => {
    const items = [{ key: "a" }, { key: "b" }, { key: "c" }];
    const first = paginateAssistantItems(items, {
      identity: "revision-a",
      section: "routes",
      limit: 1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value).toMatchObject({
      items: [{ key: "a" }],
      total: 3,
      truncated: true,
    });
    const next = paginateAssistantItems(items, {
      identity: "revision-a",
      section: "routes",
      cursor: first.value.nextCursor!,
      limit: 2,
    });
    expect(next.ok && next.value).toEqual({
      items: [{ key: "b" }, { key: "c" }],
      total: 3,
      truncated: false,
      nextCursor: null,
    });
    for (const options of [
      { identity: "revision-b", section: "routes" },
      { identity: "revision-a", section: "services" },
    ]) {
      const stale = paginateAssistantItems(items, {
        ...options,
        cursor: first.value.nextCursor!,
      });
      expect(!stale.ok && stale.failure.code).toBe("VEXT_CURSOR_STALE");
    }
  });

  it("rejects malformed cursors and response overflow", () => {
    for (const cursor of [
      "!",
      "A".repeat(2049),
      Buffer.from('{"offset":1}').toString("base64url"),
    ]) {
      expect(
        paginateAssistantItems([], {
          identity: "revision",
          section: "routes",
          cursor,
        }).ok,
      ).toBe(false);
    }
    const result = paginateAssistantItems(["x".repeat(256 * 1024)], {
      identity: "revision",
      section: "config",
    });
    expect(!result.ok && result.failure.code).toBe("VEXT_RESPONSE_LIMIT");
  });
});
