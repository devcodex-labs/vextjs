import { defineRoutes } from "vextjs";
import { s } from "schema-dsl";
import { getHeader } from "../../../../../contract.mjs";
import { increment } from "../../../../../target-runtime.mjs";

export default defineRoutes((app) => {
  app.post(
    "/:userId/orders",
    {
      middlewares: ["enterprise-auth"],
      auth: {
        permissions: ["orders:create"],
      },
      validate: {
        param: {
          userId: "integer:1-!",
        },
        body: {
          sku: "string:1-64!",
          quantity: "integer:1-!",
          unitPrice: "number:0.01-!",
          currency: s("string:3-3!").pattern(/^[A-Z]{3}$/u),
        },
      },
    },
    async (req, res) => {
      increment(app.enterpriseBenchmarkState, "controller");
      const latencyHeader = getHeader(req.headers, "x-benchmark-latency-ms");
      const delayMs = Number(latencyHeader ?? 0);
      const result = await app.services.order.create({
        userId: req.valid("param").userId,
        body: req.valid("body"),
        context: req.enterpriseContext,
        delayMs: Number.isFinite(delayMs) ? delayMs : 0,
      });
      res.json(result, 201);
    },
  );
});
