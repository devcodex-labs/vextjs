import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.patch(
    "/profile/",
    {
      docs: {
        summary: "Update one user profile",
      },
    },
    async (_req, res) => {
      res.json({ updated: true });
    },
  );
});
