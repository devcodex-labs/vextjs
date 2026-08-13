import { defineRoutes } from "vextjs";
import { withBenchmarkHandler } from "../../../handler-mode.mjs";

// GET /health → { status: "ok" }
const BENCH_ROUTE_OPTIONS = { override: { cors: { enabled: false } } };

export default defineRoutes((app) => {
  app.get(
    "/",
    BENCH_ROUTE_OPTIONS,
    withBenchmarkHandler((_req, res) => {
      res.json({ status: "ok" });
    }),
  );
});
