import { defineRoutes } from "vextjs";

// GET /users/:id → { id, name: "User {id}" }
const BENCH_ROUTE_OPTIONS = { override: { cors: { enabled: false } } };

export default defineRoutes((app) => {
  app.get("/:id", BENCH_ROUTE_OPTIONS, async (req, res) => {
    const id = req.params.id;
    res.json({ id, name: `User ${id}` });
  });
});
