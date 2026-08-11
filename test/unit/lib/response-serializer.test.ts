import { beforeEach, describe, expect, it } from "vitest";
import type { RouteOptions } from "../../../src/types/app.js";
import {
  getPreparedRouteResponseSerializers,
  getResponseSerializerDiagnostics,
  prepareRouteResponseSerializers,
  resetResponseSerializerStateForTesting,
  stringifyRouteResponse,
} from "../../../src/lib/response-serializer.js";

const context = {
  method: "POST",
  path: "/users",
  sourceFile: "src/routes/users.ts",
};

describe("response serializer registry", () => {
  beforeEach(() => resetResponseSerializerStateForTesting());

  it("selects exact, family, and default serializers", () => {
    const options: RouteOptions = {
      responses: {
        201: { schema: { exact: "string!" } },
        "2XX": { schema: { family: "string!" } },
        default: { schema: { fallback: "string!" } },
      },
    };
    const serializers = prepareRouteResponseSerializers(options, context);

    expect(
      stringifyRouteResponse(
        serializers,
        201,
        { exact: "created", family: "hidden" },
        false,
      ),
    ).toBe('{"exact":"created"}');
    expect(
      stringifyRouteResponse(
        serializers,
        202,
        { family: "accepted", extra: true },
        false,
      ),
    ).toBe('{"family":"accepted"}');
    expect(
      stringifyRouteResponse(
        serializers,
        418,
        { fallback: "teapot", extra: true },
        false,
      ),
    ).toBe('{"fallback":"teapot"}');
  });

  it("projects undeclared fields recursively and serializes the wrapper", () => {
    const options: RouteOptions = {
      responses: {
        200: {
          schema: {
            id: "integer!",
            profile: { name: "string!" },
          },
        },
      },
    };
    const serializers = prepareRouteResponseSerializers(options, context);
    const body = stringifyRouteResponse(
      serializers,
      200,
      {
        code: 0,
        data: {
          id: 1,
          ignored: true,
          profile: { name: "Ada", secret: "hidden" },
        },
        requestId: "req-1",
        internal: true,
      },
      true,
    );

    expect(JSON.parse(body)).toEqual({
      code: 0,
      data: { id: 1, profile: { name: "Ada" } },
      requestId: "req-1",
    });
  });

  it("compiles primitive, object, and nested response array shorthand", () => {
    const options: RouteOptions = {
      responses: {
        200: {
          schema: {
            "tags!": ["string"],
            "members!": [
              {
                "id!": "integer",
                "labels!": ["string"],
              },
            ],
          },
        },
      },
    };
    const serializers = prepareRouteResponseSerializers(options, context);

    expect(
      JSON.parse(
        stringifyRouteResponse(
          serializers,
          200,
          {
            tags: ["api", "runtime"],
            members: [{ id: 1, labels: ["owner"], internal: "projected" }],
            extra: true,
          },
          false,
        ),
      ),
    ).toEqual({
      tags: ["api", "runtime"],
      members: [{ id: 1, labels: ["owner"] }],
    });
  });

  it("accepts self-contained raw JSON Schema through the public route type", () => {
    const options: RouteOptions = {
      responses: {
        200: {
          schema: {
            type: "object",
            properties: { id: { type: "integer" } },
            required: ["id"],
            additionalProperties: false,
          },
        },
      },
    };
    const serializers = prepareRouteResponseSerializers(options, context);

    expect(
      stringifyRouteResponse(serializers, 200, { id: 1, extra: true }, false),
    ).toBe('{"id":1}');
  });

  it("fails on missing required data", () => {
    const options: RouteOptions = {
      responses: { 200: { schema: { id: "integer!" } } },
    };
    const serializers = prepareRouteResponseSerializers(options, context);

    expect(() => stringifyRouteResponse(serializers, 200, {}, false)).toThrow(
      /id.*required|required.*id/i,
    );
  });

  it("keeps docs-only schemas on JSON.stringify and rejects dual schema truth", () => {
    const docsOnly: RouteOptions = {
      docs: { responses: { 200: { schema: { id: "integer!" } } } },
    };
    expect(prepareRouteResponseSerializers(docsOnly, context)).toBeUndefined();
    expect(
      stringifyRouteResponse(undefined, 200, { id: 1, extra: true }, false),
    ).toBe('{"id":1,"extra":true}');

    expect(() =>
      prepareRouteResponseSerializers(
        {
          responses: { 200: { schema: { id: "integer!" } } },
          docs: { responses: { 200: { schema: { id: "integer!" } } } },
        },
        context,
      ),
    ).toThrow(/POST \/users.*selector 200.*both/i);
  });

  it("compiles each RouteOptions and HTTP method identity once", () => {
    const options: RouteOptions = {
      responses: { 200: { schema: { id: "integer!" } } },
    };
    const first = prepareRouteResponseSerializers(options, context);
    const second = prepareRouteResponseSerializers(options, context);

    expect(second).toBe(first);
    expect(getResponseSerializerDiagnostics()).toEqual({
      routeOptionsCompiled: 1,
      serializerFunctionsCompiled: 2,
    });
  });

  it("isolates HEAD and body-capable serializer cache entries", () => {
    const options: RouteOptions = {
      responses: { 200: { schema: { id: "integer!" } } },
    };

    expect(
      prepareRouteResponseSerializers(options, {
        ...context,
        method: "HEAD",
      }),
    ).toBeUndefined();
    const getSerializers = prepareRouteResponseSerializers(options, {
      ...context,
      method: "GET",
    });

    expect(
      getPreparedRouteResponseSerializers(options, "HEAD"),
    ).toBeUndefined();
    expect(getPreparedRouteResponseSerializers(options, "get")).toBe(
      getSerializers,
    );
    expect(
      stringifyRouteResponse(
        getSerializers,
        200,
        { id: 1, internal: "projected" },
        false,
      ),
    ).toBe('{"id":1}');
    expect(getResponseSerializerDiagnostics()).toEqual({
      routeOptionsCompiled: 1,
      serializerFunctionsCompiled: 2,
    });
  });

  it("keeps HEAD bodyless when GET was prepared first", () => {
    const options: RouteOptions = {
      responses: { 200: { schema: { id: "integer!" } } },
    };

    expect(
      prepareRouteResponseSerializers(options, {
        ...context,
        method: "GET",
      }),
    ).toBeDefined();
    expect(
      prepareRouteResponseSerializers(options, {
        ...context,
        method: "HEAD",
      }),
    ).toBeUndefined();
    expect(
      getPreparedRouteResponseSerializers(options, "HEAD"),
    ).toBeUndefined();
  });

  it("bypasses registration-time compilation for HEAD and exact 204 bodies", () => {
    const noContent: RouteOptions = {
      responses: { 204: { schema: { ignored: "string!" } } },
    };
    expect(prepareRouteResponseSerializers(noContent, context)).toBeUndefined();

    const head: RouteOptions = {
      responses: { 200: { schema: { ignored: "string!" } } },
    };
    expect(
      prepareRouteResponseSerializers(head, { ...context, method: "HEAD" }),
    ).toBeUndefined();
    expect(getResponseSerializerDiagnostics()).toEqual({
      routeOptionsCompiled: 0,
      serializerFunctionsCompiled: 0,
    });
  });

  it("includes route identity when registration-time compilation fails", () => {
    expect(() =>
      prepareRouteResponseSerializers(
        {
          responses: {
            200: { schema: "#/components/schemas/Missing" },
          },
        },
        context,
      ),
    ).toThrow(/POST \/users.*selector 200.*src\/routes\/users\.ts/i);
  });
});
