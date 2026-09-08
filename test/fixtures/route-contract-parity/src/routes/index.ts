import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      docs: {
        summary: "Root status",
        operationId: "getRootStatus",
        tags: ["status"],
      },
      validate: { query: { traceId: "string!" } },
      responses: { 200: { schema: { ok: "boolean!" } } },
    },
    async (_req, res) => {
      res.json({ ok: true });
    },
  );
});
