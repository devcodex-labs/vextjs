import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { chromium } from "playwright-core";
import { bootstrap } from "../dist/lib/bootstrap.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "vext-browser-consumer-"));
const output = path.resolve(
  process.env.VEXT_BROWSER_OUTPUT ?? "output/frontend-browser",
);
const observations = [];
let runtime;
let browser;
async function write(name, contents) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}
try {
  await mkdir(output, { recursive: true });
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  await write(
    "package.json",
    '{"name":"frontend-browser-consumer","version":"0.0.0","type":"module","private":true,"dependencies":{"vextjs":"2.0.0"}}',
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
  await write(
    "src/config/default.mjs",
    `export default {
    port: ${port}, host: "127.0.0.1", adapter: "native", logger: { level: "silent" }, openapi: { enabled: false },
    locale: { default: "en-US", supported: ["en-US", "zh-CN"] },
    frontend: { enabled: true, apiClient: false, publicPath: "/app/", render: { layout: false },
      i18n: { enabled: true, defaultLocale: "en-US", detect: ["query", "cookie", "accept-language"], inject: "all", clientLoad: "current" } }
  };`,
  );
  await write(
    "src/routes/index.mjs",
    `import { defineRoutes } from "vextjs";
export default defineRoutes(app => {
  app.get("/favicon.ico", (req,res) => res.status(204).text(""));
  app.get("/app/", { frontend: { page: "index", mode: "static" } }, (req,res) => res.render("index", { path: req.path }));
  app.get("/app/next", { frontend: { page: "index", mode: "static" } }, (req,res) => res.render("index", { path: req.path }));
  app.get("/app/messages", { frontend: { page: "index" } }, (req,res) => res.render("index", { path: req.path }, { messages: { title: "Custom title" } }));
  app.get("/app/csr", { frontend: { page: "index" } }, (req,res) => res.render("index", { path: req.path }, { ssr: false }));
  app.get("/app/client-only", { frontend: { page: "index", clientOnly: true } }, (req,res) => res.render("index", { path: req.path }));
  app.get("/app/fallback", { frontend: { page: "index" } }, (req,res) => res.render("index", { path: req.path, fail: true }));
  app.get("/app/empty", { frontend: { page: "empty" } }, (req,res) => res.render("empty"));
  app.get("/app/static", { frontend: { page: "index", hydration: "none" } }, (req,res) => res.render("index", { path: req.path }));
  app.get("/app/override", { frontend: { page: "index", mode: "static" } }, (req,res) => res.render("index", { path: req.path }, { locale: "zh-CN" }));
  app.get("/app/failure", (req,res) => { req.requestId = "browser-probe"; res.renderError(409, { code: "CONFLICT", message: "Page conflict" }); });
});`,
  );
  await write(
    "src/frontend/pages/_document.html",
    "<!doctype html><html><head>{vext.styles}</head><body>{vext.root}{vext.data}{vext.entry}</body></html>",
  );
  await write(
    "public/sitemap.xml",
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>',
  );
  await write("public/robots.txt", "User-agent: *\nAllow: /\n");
  await write(
    "src/frontend/pages/layout.tsx",
    'export default function Layout({children}) { return <section data-layout="root">{children}</section>; }',
  );
  await write(
    "src/frontend/pages/empty.tsx",
    "export default function Empty() { return null; }",
  );
  await write(
    "src/frontend/styles/base.module.css",
    ".base { background-color: rgb(0, 0, 255); }",
  );
  await write(
    "src/frontend/styles/card.module.css",
    '.card { composes: base from "./base.module.css"; color: rgb(255, 0, 0); } .default { font-weight: 700; } .__proto__ { padding-top: 7px; }',
  );
  await write(
    "src/frontend/components/card.module.css",
    ".card { color: rgb(0, 128, 0); }",
  );
  await write(
    "src/frontend/imports/logo.png",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3k0AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await write("src/frontend/locales/en-US.json", '{"title":"Hello"}');
  await write("src/frontend/locales/zh-CN.json", '{"title":"中文"}');
  await write(
    "src/locales/en-US.json",
    '{"private":"BACKEND_SECRET_NOT_FOR_BROWSER"}',
  );
  await write(
    "src/frontend/pages/index.tsx",
    `import { useEffect, useState } from "react";
import { Link, useFetcher, useVextI18n, VextPageResultError } from "vextjs/frontend";
import styles from "../styles/card.module.css"; import other from "../components/card.module.css"; import logo from "../imports/logo.png";
export default function Page(props) {
  if (props.fail && typeof window === "undefined") throw new Error("SSR fallback probe");
  const [count, setCount] = useState(0); const messages = useVextI18n(); const fetcher = useFetcher();
  useEffect(() => { document.body.dataset.hydrated = "yes"; }, []);
  return <main className={styles.card}><h1>{messages.title}</h1><p id="path">{props.path}</p>
    <img src={logo} alt="logo"/><aside className={other.card}>Other</aside>
    <span id="special" className={[styles.default, styles.__proto__].join(" ")}>Special</span>
    <button id="counter" onClick={() => setCount(count+1)}>Count {count}</button>
    <Link id="next" href="/app/next?locale=zh-CN">Next language</Link>
    <Link id="custom" href="/app/messages?locale=en-US">Custom messages</Link>
    <button id="failure" onClick={() => fetcher.load("/app/failure")}>Failure</button>
    <output id="error">{fetcher.error instanceof VextPageResultError ? [fetcher.error.status, fetcher.error.code, fetcher.error.requestId].join(":") : ""}</output>
  </main>;
}`,
  );
  const build = spawnSync(
    process.execPath,
    [path.join(repository, "dist/cli/index.js"), "build"],
    {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 60000,
    },
  );
  await writeFile(
    path.join(output, "consumer-build.log"),
    build.stdout + build.stderr,
  );
  assert.equal(build.status, 0, build.stdout + build.stderr);
  runtime = await bootstrap(root);
  const base = `http://127.0.0.1:${runtime.serverHandle.port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.VEXT_BROWSER_EXECUTABLE
      ? { executablePath: process.env.VEXT_BROWSER_EXECUTABLE }
      : {}),
    args: ["--no-sandbox"],
  });

  for (const javascript of [false, true]) {
    const context = await browser.newContext({ javaScriptEnabled: javascript });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(base + "/app/?locale=en-US", { waitUntil: "networkidle" });
    const style = await page.locator("main").evaluate((node) => ({
      color: getComputedStyle(node).color,
      background: getComputedStyle(node).backgroundColor,
    }));
    assert.deepEqual(style, {
      color: "rgb(255, 0, 0)",
      background: "rgb(0, 0, 255)",
    });
    assert.equal(
      await page
        .locator("aside")
        .evaluate((node) => getComputedStyle(node).color),
      "rgb(0, 128, 0)",
    );
    assert.equal(await page.locator("[data-layout]").count(), 0);
    assert.deepEqual(
      await page.locator("#special").evaluate((node) => ({
        weight: getComputedStyle(node).fontWeight,
        padding: getComputedStyle(node).paddingTop,
      })),
      { weight: "700", padding: "7px" },
    );
    assert.equal(
      await page
        .locator("img")
        .evaluate((node) => node.complete && node.naturalWidth > 0),
      true,
    );
    if (javascript) {
      await page.waitForFunction(
        () => document.body.dataset.hydrated === "yes",
      );
      await page.locator("#counter").click();
      await page.getByRole("button", { name: "Count 1" }).waitFor();
      assert.equal(
        await page
          .locator("main")
          .evaluate((node) => getComputedStyle(node).color),
        "rgb(255, 0, 0)",
      );
      await page.evaluate(() => (window.__navigationSentinel = "retained"));
      await page.locator("#custom").click();
      await page.waitForFunction(
        () => document.querySelector("h1").textContent === "Custom title",
      );
      await page.locator("#next").click();
      await page.waitForFunction(
        () => document.querySelector("h1").textContent === "中文",
      );
      assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
      assert.equal(
        await page.evaluate(() => window.__navigationSentinel),
        "retained",
      );
      await page.locator("#failure").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#error").textContent ===
          "409:CONFLICT:browser-probe",
      );
      // The deliberately requested 409 may generate a network console message.
      assert.deepEqual(
        errors.filter((error) => !error.includes("409")),
        [],
      );
    } else assert.deepEqual(errors, []);
    await page.screenshot({
      path: path.join(output, `css-${javascript ? "hydrated" : "ssr"}.png`),
    });
    observations.push({
      case: "CSS, assets, layouts, navigation and error class",
      javascript,
      status: "PASS",
    });
    await context.close();
  }
  for (const route of ["csr", "client-only", "fallback", "empty"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const response = await page.goto(`${base}/app/${route}`, {
      waitUntil: "networkidle",
    });
    const html = await response.text();
    assert.match(
      html,
      new RegExp(`"mountMode":"${route === "empty" ? "server" : "client"}"`),
    );
    if (route !== "empty") {
      await page.locator("#counter").click();
      await page.getByRole("button", { name: "Count 1" }).waitFor();
    }
    assert.deepEqual(errors, []);
    observations.push({ case: route, status: "PASS" });
    await page.close();
  }
  for (const locale of ["en-US", "zh-CN"]) {
    for (const expected of ["miss", "hit"]) {
      const response = await fetch(base + "/app/", {
        headers: { "accept-language": locale },
      });
      const html = await response.text();
      assert.equal(response.headers.get("x-vext-freshness"), expected);
      assert.match(response.headers.get("vary"), /Accept-Language/i);
      assert.match(html, new RegExp(`<html lang="${locale}">`));
      assert.ok(html.includes(locale === "zh-CN" ? "中文" : "Hello"));
      assert.ok(!html.includes("BACKEND_SECRET_NOT_FOR_BROWSER"));
    }
  }
  const cookie = await fetch(base + "/app/", {
    headers: { cookie: "locale=zh-CN" },
  });
  assert.equal(cookie.headers.get("cache-control"), "private, no-store");
  assert.equal(cookie.headers.get("x-vext-freshness"), "bypass");
  const override = await fetch(base + "/app/override", {
    headers: { "accept-language": "en-US" },
  });
  assert.equal(override.headers.get("cache-control"), "private, no-store");
  assert.equal(override.headers.get("x-vext-freshness"), "bypass");
  const staticHtml = await (await fetch(base + "/app/static")).text();
  assert.ok(!staticHtml.includes("data-vext-entry"));
  for (const [file, mime] of [
    ["sitemap.xml", "application/xml; charset=utf-8"],
    ["robots.txt", "text/plain; charset=utf-8"],
  ]) {
    const response = await fetch(`${base}/app/${file}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), mime);
  }
  observations.push({
    case: "locale freshness miss/hit, private bypass and hydration none",
    status: "PASS",
  });
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      { status: "PASS", browser: browser.version(), observations },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ status: "PASS", observations }, null, 2));
} catch (error) {
  await writeFile(
    path.join(output, "failure.txt"),
    String(error.stack ?? error),
  );
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page
          .screenshot({ path: path.join(output, "failure.png") })
          .catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close();
  if (runtime) {
    await runtime.serverHandle.close();
    await runtime.internals.shutdown(undefined, { skipExit: true });
  }
  await rm(root, { recursive: true, force: true });
}
