import { defineRoutes } from "vextjs";

// GET /health → { status: "ok" }
const BENCH_ROUTE_OPTIONS = { override: { cors: { enabled: false } } };

export default defineRoutes((app) => {
  app.get("/", BENCH_ROUTE_OPTIONS, async (_req, res) => {
    res.json({ status: "ok" });
  });
});
