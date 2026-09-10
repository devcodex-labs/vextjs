import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { bootstrap } from "../../dist/lib/bootstrap.js";
import { buildFrontendClient } from "../../dist/frontend/tooling/client-build-compiler.js";

// 浏览器手工/CLI验收使用实际编译、SSR和hydration入口，不模拟React上下文。
const repository = fileURLToPath(new URL("../../", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "vext-locale-browser-"));
let runtime;
async function write(name, source) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source);
}
async function close() {
  try {
    if (runtime) await runtime.serverHandle.close();
  } finally {
    if (runtime)
      await runtime.internals.shutdown(undefined, { skipExit: true });
    if (
      path.dirname(root) !== tmpdir() ||
      !path.basename(root).startsWith("vext-locale-browser-")
    )
      throw new Error("Unexpected fixture cleanup root");
    await rm(root, { recursive: true, force: true });
  }
}
try {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  await write(
    "package.json",
    '{"name":"vext-locale-browser","type":"module","private":true}',
  );
  await mkdir(path.join(root, "node_modules"));
  for (const name of ["vextjs", "react", "react-dom"])
    await symlink(
      name === "vextjs"
        ? repository
        : path.join(repository, "node_modules", name),
      path.join(root, "node_modules", name),
      process.platform === "win32" ? "junction" : "dir",
    );
  const frontend = {
    enabled: true,
    apiClient: false,
    i18n: { enabled: true, defaultLocale: "en-US", clientLoad: "current" },
  };
  await write(
    "src/config/default.js",
    `export default ${JSON.stringify({ port, host: "127.0.0.1", logger: { level: "silent" }, openapi: { enabled: false }, frontend })};`,
  );
  await write(
    "src/routes/index.js",
    `import { defineRoutes } from "vextjs";
export default defineRoutes(app => {
  app.get("/", { frontend: { page: "index" } }, (req,res) => res.render("index", { path: req.path }, { locale: req.query.lang === "zh" ? "zh-CN" : "en-US" }));
  app.get("/next", { frontend: { page: "index" } }, (req,res) => res.render("index", { path: req.path }, { locale: req.query.lang === "zh" ? "zh-CN" : "en-US" }));
  app.get("/__close", (req,res) => { res.text("closing"); setTimeout(() => globalThis.__closeLocaleFixture(), 20); });
});`,
  );
  await write(
    "src/frontend/pages/_document.html",
    '<!doctype html><html lang="{vext.lang}"><head>{vext.styles}</head><body>{vext.root}{vext.data}{vext.entry}</body></html>',
  );
  await write(
    "src/frontend/pages/index.tsx",
    `import { useEffect, useState } from "react";
import { useVextI18n, Link } from "vextjs/frontend";
export default function Page(props) {
  const messages = useVextI18n();
  const [count, setCount] = useState(0);
  useEffect(() => { document.body.dataset.hydrated = "yes"; }, []);
  return <main><h1>{messages.order.payment.title}</h1><p id="path">{props.path}</p><button id="counter" onClick={() => setCount(count + 1)}>{count}</button><a id="chinese" href="/?lang=zh">中文</a><Link id="next" href="/next?lang=zh">下一页</Link></main>;
}`,
  );
  await write(
    "src/frontend/locales/order/payment/en-US.json",
    '{"title":"Payment"}',
  );
  await write(
    "src/frontend/locales/order/payment/zh-CN.json",
    '{"title":"支付"}',
  );
  await write(
    "src/locales/order/payment/en-US.json",
    '{"private":"BACKEND_SECRET_NOT_FOR_BROWSER"}',
  );
  const build = await buildFrontendClient({
    rootDir: root,
    config: frontend,
    mode: "production",
  });
  if (build.skipped) throw new Error("Frontend fixture build was skipped");
  runtime = await bootstrap(root);
  let closing = false;
  globalThis.__closeLocaleFixture = () => {
    if (!closing) {
      closing = true;
      close().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    }
  };
  console.log(
    JSON.stringify({
      pid: process.pid,
      root,
      port: runtime.serverHandle.port,
      url: `http://127.0.0.1:${runtime.serverHandle.port}/`,
    }),
  );
} catch (error) {
  console.error(error);
  await close();
  process.exitCode = 1;
}
