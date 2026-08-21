import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hello-world keeps its executable public contract", async () => {
  const [config, routes] = await Promise.all([
    readFile(new URL("../src/config/default.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/index.js", import.meta.url), "utf8"),
  ]);

  assert.match(config, /rateLimit:\s*\{\s*enabled: false,/);
  assert.match(config, /openapi:\s*\{\s*enabled: true,/);
  assert.match(routes, /app\.get\("\/"/);
  assert.match(routes, /app\.get\("\/health"/);
});
