import { defineRoutes } from "vextjs";
import { s } from "schema-dsl";

import { createError } from "../../../../../application-model.mjs";

export default defineRoutes((app) => {
  app.get("/:userId/orders", async (req, res) => {
    res.json(createError("METHOD_NOT_ALLOWED", req.requestId), 405);
  });

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
      const result = await app.services.order.create({
        userId: req.valid("param").userId,
        body: req.valid("body"),
      });
      res.json(result, 201);
    },
  );
});
