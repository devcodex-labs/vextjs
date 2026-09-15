import { describe, expect, it } from "vitest";
import { inspectRouteFacts } from "../../../src/tooling/project-index/route-facts.js";

describe("MCP route contract facts", () => {
  it("resolves local handlers and keeps imported handlers unknown", () => {
    const facts = inspectRouteFacts(
      "src/routes/blog.ts",
      `
      import { defineRoutes } from 'vextjs';
      import handler from '../utils/handler.js';
      const local = (req, res) => res.json({ ok: true });
      const register = app => { app.get('/local', {}, local); app.get('/imported', {}, handler); };
      export default defineRoutes(register);
    `,
    );
    expect(facts.state).toBe("complete");
    expect(facts.routes.map((route) => route.returnsJson)).toEqual([
      true,
      null,
    ]);
  });

  it("distinguishes absent and invalid response declarations", () => {
    const facts = inspectRouteFacts(
      "src/routes/blog.ts",
      `
      import { defineRoutes } from 'vextjs';
      export default defineRoutes(app => {
        app.get('/null', { responses: null }, (req, res) => res.json({}));
        app.get('/invalid', { responses: 'schema' }, (req, res) => res.json({}));
      });
    `,
    );
    expect(facts.routes.map((route) => route.responses)).toEqual([
      "absent",
      "invalid",
    ]);
  });

  it("keeps runtime response contracts separate for each route and from docs metadata", () => {
    const result = inspectRouteFacts(
      "src/routes/blog.ts",
      `
      import { defineRoutes as routes } from "vextjs";
      export default routes(app => {
        app.get("/first", { responses: { 200: { id: "string!" } } }, (req, reply) => reply.json({ id: "one" }));
        app.get("/second", { docs: { responses: { 200: { description: "Metadata" } } }, cache: { tags: ["blog"] } }, (req, reply) => reply.json({ id: "two" }));
      });
    `,
    );
    expect(result.state).toBe("complete");
    expect(
      result.routes.map((route) => [
        route.responses,
        route.returnsJson,
        route.deprecatedDocsTags,
      ]),
    ).toEqual([
      ["present", true, false],
      ["absent", true, false],
    ]);
  });

  it("does not mistake strings or a shadowed response-like object for the response binding", () => {
    const result = inspectRouteFacts(
      "src/routes/blog.ts",
      `
      import { defineRoutes } from "vextjs";
      export default defineRoutes(app => {
        app.get("/", {}, (req, res) => {
          const text = "res.json({})";
          function unused(res) { return res.json({}); }
          function capturesOuterResponse() { return res.json({}); }
          return text;
        });
      });
    `,
    );
    expect(result.routes[0]?.returnsJson).toBe(false);
  });

  it("does not trust unrelated functions named like the framework helper", () => {
    expect(
      inspectRouteFacts(
        "src/routes/blog.ts",
        `
      import { defineRoutes } from "another-library";
      export default defineRoutes(app => { app.get("/", {}, (req, res) => res.json({})); });
    `,
      ).state,
    ).toBe("unknown");
  });

  it("reports dynamic options as unknown instead of claiming a missing contract", () => {
    const result = inspectRouteFacts(
      "src/routes/blog.ts",
      `
      import { defineRoutes } from "vextjs";
      export default defineRoutes(app => { app.get("/", makeOptions(), (req, res) => res.json({})); });
    `,
    );
    expect(result.routes[0]?.responses).toBe("unknown");
  });
});
