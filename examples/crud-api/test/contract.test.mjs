import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CRUD example keeps the seven-item public contract", async () => {
  const [config, model, service, routes] = await Promise.all([
    readFile(new URL("../src/config/default.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/models/todo.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/services/todo.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/todos.ts", import.meta.url), "utf8"),
  ]);

  assert.match(config, /MONGODB_URI is required/);
  assert.match(config, /rateLimit:\s*\{\s*enabled: false,/);
  assert.match(model, /id: "string:1-!"/);
  assert.equal((routes.match(/id: "string:1-!"/g) ?? []).length, 3);
  assert.match(routes, /req\.valid\("param"\)/);
  assert.match(service, /const database = this\.app\.db/);
  assert.match(service, /database\.model<TodoDocument>\("todos"\)/);
  assert.doesNotMatch(service, /app\.monsqlize/);
});
