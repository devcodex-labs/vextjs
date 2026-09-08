import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post("/daily/", async (_req, res) => {
    res.json({ queued: true });
  });
});
