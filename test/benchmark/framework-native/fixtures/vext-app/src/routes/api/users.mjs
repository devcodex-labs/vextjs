import { defineRoutes } from "vextjs";
import { s } from "schema-dsl";
import { benchmarkRuntime } from "../../plugins/benchmark-runtime.mjs";

export default defineRoutes((app) => {
  app.post(
    "/:userId/orders",
    {
      middlewares: ["benchmark-auth"],
      auth: { permissions: ["orders:write"] },
      validate: {
        param: { userId: "integer:1-!" },
        body: {
          sku: "string:1-64!",
          quantity: "integer:1-!",
          unitPrice: "number:0.01-!",
          currency: s("string:3-3!").pattern(/^[A-Z]{3}$/u),
        },
      },
    },
    async (req, res) => {
      benchmarkRuntime.record("controller");
      const result = await app.services.order.create({
        userId: req.valid("param").userId,
        body: req.valid("body"),
      });
      res.json(result, 201);
    },
  );
});
