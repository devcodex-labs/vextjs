import { describe, expect, it } from "vitest";
import { parseJSDocSymbols } from "../../../src/lib/docs/sources/jsdoc-parser.js";

describe("parseJSDocSymbols", () => {
  it("parses standard JSDoc for exported functions", () => {
    const symbols = parseJSDocSymbols(`
/**
 * Format a user name.
 *
 * Keeps display labels stable.
 * @param {string} name - Raw user name.
 * @returns {string} Formatted user name.
 * @throws {Error} When name is empty.
 * @example
 * formatName("rocky")
 */
export function formatName(name: string): string {
  return name.trim()
}
`);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      exportName: "formatName",
      kind: "function",
      summary: "Format a user name.",
      description: "Format a user name.\nKeeps display labels stable.",
      params: [
        {
          name: "name",
          type: "string",
          description: "Raw user name.",
        },
      ],
      returns: { type: "string", description: "Formatted user name." },
      throws: [{ type: "Error", description: "When name is empty." }],
      examples: ['formatName("rocky")'],
    });
  });

  it("parses class methods and deprecated tags", () => {
    const symbols = parseJSDocSymbols(`
export class UserService {
  /**
   * Find a user.
   * @deprecated Use getUser instead.
   */
  async findUser(id: string) {
    return { id }
  }
}
`);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      exportName: "findUser",
      kind: "method",
      deprecated: "Use getUser instead.",
    });
  });

  it("skips private, protected and underscore-prefixed methods", () => {
    const symbols = parseJSDocSymbols(`
export class UserService {
  /**
   * Internal seed.
   */
  private seed() {}

  /**
   * Protected helper.
   */
  protected resolve() {}

  /**
   * Internal underscore helper.
   */
  _normalize() {}

  /**
   * Public method.
   */
  public listUsers() {}
}
`);

    expect(symbols.map((symbol) => symbol.exportName)).toEqual(["listUsers"]);
  });
});
