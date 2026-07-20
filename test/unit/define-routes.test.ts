import { describe, expect, it } from "vitest";
import {
  defineRoutes,
  executeRouteFactory,
} from "../../src/lib/define-routes.js";
import type { VextApp } from "../../src/types/app.js";

function createMinimalApp(): VextApp {
  return {
    config: {},
    services: {},
    logger: {},
    adapter: {},
    throw: () => {
      throw new Error("app.throw");
    },
  } as unknown as VextApp;
}

describe("defineRoutes runtime boundary", () => {
  it("rejects a non-function factory at the public boundary", () => {
    expect(() => defineRoutes(null as never)).toThrow(
      "[vextjs] defineRoutes(factory) expects a function.",
    );
  });

  it("rejects invalid collector path, options, and handler inputs with Vext errors", () => {
    const cases = [
      {
        routeDef: defineRoutes((app) => {
          (app as any).get(42, async () => undefined);
        }),
        message: "GET route path must be a string",
      },
      {
        routeDef: defineRoutes((app) => {
          (app as any).post("/users", null, async () => undefined);
        }),
        message: 'POST "/users": route options must be a plain object',
      },
      {
        routeDef: defineRoutes((app) => {
          (app as any).put("/users", {}, "not-a-handler");
        }),
        message: 'PUT "/users": handler must be a function',
      },
    ];

    for (const item of cases) {
      expect(() =>
        executeRouteFactory(item.routeDef, createMinimalApp()),
      ).toThrow(item.message);
    }
  });

  it("keeps route factory internals out of the enumerable public shape", () => {
    const routeDef = defineRoutes((app) => {
      app.get("/health", async () => undefined);
    });

    expect(Object.keys(routeDef)).toEqual(["routes", "sourceFile", "register"]);
    expect(Object.prototype.hasOwnProperty.call(routeDef, "_factory")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(routeDef, "_collector")).toBe(
      false,
    );
    expect(
      Object.getOwnPropertyDescriptor(routeDef, "_factory"),
    ).toBeUndefined();

    executeRouteFactory(routeDef, createMinimalApp());
    executeRouteFactory(routeDef, createMinimalApp());

    expect(routeDef.routes).toHaveLength(1);
    expect(routeDef.routes[0]).toMatchObject({
      method: "GET",
      path: "/health",
    });
  });
});
