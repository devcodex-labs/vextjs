import { describe, expect, it } from "vitest";
import { flattenQueryRecord, parseQueryString } from "../../src/lib/query.js";

describe("query normalization", () => {
  it("uses first-wins for multi-value query strings", () => {
    expect(parseQueryString("dup=a&dup=b")).toEqual({ dup: "a" });
    expect(parseQueryString("single=value&empty=")).toEqual({
      single: "value",
      empty: "",
    });
  });

  it("flattens host framework arrays to the first string", () => {
    expect(
      flattenQueryRecord({
        dup: ["a", "b"],
        single: "value",
        nested: { ignored: true },
      }),
    ).toEqual({
      dup: "a",
      single: "value",
    });
  });
});
