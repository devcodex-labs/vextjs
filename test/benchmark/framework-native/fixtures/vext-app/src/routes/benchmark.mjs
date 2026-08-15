import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", target: "vext-native" });
  });
  app.post("/reset", (_req, res) => {
    res.json(app.frameworkNativeBenchmarkRuntime.reset());
  });
  app.get("/stats", (_req, res) => {
    res.json(app.frameworkNativeBenchmarkRuntime.snapshot());
  });
});
