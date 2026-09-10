import { createServer } from "node:http";
import { normalizeDocsConfig } from "../../src/lib/docs/normalize-config.js";
import { renderVextDocsHTML } from "../../src/lib/docs/renderers/vext-html.js";
import {
  VEXT_DOCS_APP_JS,
  VEXT_DOCS_STYLE_CSS,
  VEXT_DOCS_FAVICON_SVG,
} from "../../src/lib/docs/renderers/vext-assets.js";

// CLI browser regression fixture: serves the real Docs assets and captures wire bodies.
const config = normalizeDocsConfig({ docs: { ui: { defaultView: "api" } } });
const content = {
  "text/plain": { schema: { type: "string" }, example: "123" },
  "application/json": {
    schema: { type: "object" },
    example: { title: "Vext" },
  },
  "application/x-www-form-urlencoded": {
    schema: { type: "object" },
    example: { title: "你好 world", tag: ["a", "b"] },
  },
  "multipart/form-data": {
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  },
};
const spec = {
  openapi: "3.0.3",
  info: { title: "Docs B regression", version: "1.0.0" },
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  },
  security: [{ bearer: [] }],
  paths: Object.fromEntries(
    ["/echo", "/other"].map((route) => [
      route,
      {
        post: {
          summary: route === "/echo" ? "Echo media" : "Other operation",
          requestBody: { required: true, content },
          responses: { "200": { description: "Captured request" } },
        },
      },
    ]),
  ),
};
const requests: unknown[] = [];
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  let type = "application/json";
  let body: unknown;
  if (pathname === config.path) {
    type = "text/html";
    body = renderVextDocsHTML(config);
  } else if (pathname === config.endpoints.appJs) {
    type = "application/javascript";
    body = VEXT_DOCS_APP_JS;
  } else if (pathname === config.endpoints.styleCss) {
    type = "text/css";
    body = VEXT_DOCS_STYLE_CSS;
  } else if (pathname === config.endpoints.faviconSvg) {
    type = "image/svg+xml";
    body = VEXT_DOCS_FAVICON_SVG;
  } else if (
    pathname === config.endpoints.openapi ||
    pathname === config.specPath
  )
    body = spec;
  else if (pathname === config.endpoints.config)
    body = {
      ui: config.ui,
      endpoints: config.publicEndpoints,
      tryItOut: config.tryItOut,
      sources: [],
    };
  else if (pathname === config.endpoints.code) body = { items: [] };
  else if (pathname === "/requests") body = requests;
  else if (pathname === "/echo" || pathname === "/other") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    body = {
      method: req.method,
      authorization: req.headers.authorization ?? null,
      contentType: req.headers["content-type"] ?? null,
      body: Buffer.concat(chunks).toString("utf8"),
    };
    requests.push(body);
  } else {
    res.statusCode = 404;
    body = { error: "not found" };
  }
  res.setHeader("content-type", `${type}; charset=utf-8`);
  res.end(type === "application/json" ? JSON.stringify(body) : String(body));
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string")
    console.log(
      JSON.stringify({
        pid: process.pid,
        port: address.port,
        url: `http://127.0.0.1:${address.port}${config.path}`,
      }),
    );
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => server.close());
