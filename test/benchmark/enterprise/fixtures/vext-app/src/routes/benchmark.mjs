import { defineRoutes } from "vextjs";
import {
  resetEnterpriseState,
  snapshotEnterpriseState,
} from "../../../../target-runtime.mjs";

export default defineRoutes((app) => {
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", target: "vext-native" });
  });
  app.post("/reset", (_req, res) => {
    res.json(resetEnterpriseState(app.enterpriseBenchmarkState));
  });
  app.get("/stats", (_req, res) => {
    res.json(snapshotEnterpriseState(app.enterpriseBenchmarkState));
  });
});
