import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get(
    "/",
    {
      validate: { query: { limit: "integer:1-100?" } },
      docs: { summary: "List todos" },
    },
    async (req, res) => {
      const { limit } = req.valid("query");
      res.json({ items: await app.services.todo.list(limit) });
    },
  );

  app.get(
    "/:id",
    {
      validate: { param: { id: "string:1-!" } },
      docs: { summary: "Read a todo" },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      res.json(await app.services.todo.find(id));
    },
  );

  app.post(
    "/",
    {
      validate: { body: { title: "string:1-120!" } },
      docs: { summary: "Create a todo" },
    },
    async (req, res) => {
      const { title } = req.valid("body");
      res.json(await app.services.todo.create(title), 201);
    },
  );

  app.patch(
    "/:id",
    {
      validate: {
        param: { id: "string:1-!" },
        body: {
          title: "string:1-120?",
          completed: "boolean?",
        },
      },
      docs: { summary: "Update a todo" },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      res.json(await app.services.todo.update(id, req.valid("body")));
    },
  );

  app.delete(
    "/:id",
    {
      validate: { param: { id: "string:1-!" } },
      docs: { summary: "Delete a todo" },
    },
    async (req, res) => {
      const { id } = req.valid("param");
      await app.services.todo.remove(id);
      res.json({ deleted: true, id });
    },
  );
});
