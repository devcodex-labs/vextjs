import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, (_req, res) => {
    res.json({
      example: "vextjs-crud-api",
      database: "app.db",
      docs: "/docs",
    });
  });

  app.get("/health", {}, (_req, res) => {
    res.json({ status: "ok" });
  });
});
