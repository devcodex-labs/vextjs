import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// An existing Playwright installation is supplied by the validation host; this script never installs packages or browsers.
const modulePath = process.env.VEXT_PLAYWRIGHT_MODULE;
if (!modulePath)
  throw new Error(
    "VEXT_PLAYWRIGHT_MODULE must point to an existing Playwright entrypoint",
  );
const { chromium } = await import(pathToFileURL(modulePath).href);
const [base, token] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.VEXT_BROWSER_EXECUTABLE
    ? { executablePath: process.env.VEXT_BROWSER_EXECUTABLE }
    : {}),
});
const checks = [];
try {
  const context = await browser.newContext({ timezoneId: "Pacific/Honolulu" });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const failures = [];
  const assets = new Set();
  const requestedUrls = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|Minified React error/u.test(message.text())
    )
      failures.push(message.text());
  });
  page.on("request", (request) => requestedUrls.push(request.url()));
  page.on("response", (response) => {
    if (/\.(js|json)(?:\?|$)/u.test(response.url())) assets.add(response.url());
  });
  await page.goto(base + "/");
  await page.waitForLoadState("networkidle");
  assert.equal(await page.locator("h1").textContent(), "Blog");
  assert.equal(await page.locator("article").count(), 12);
  assert.equal(await page.locator("time").first().textContent(), "1/1/2026");
  assert.equal((await page.content()).includes("PRIVATE_DRAFT"), false);
  await page.evaluate(() => {
    window.__blogNavigationSentinel = "retained";
  });
  await page.getByRole("link", { name: "Next page", exact: true }).click();
  await page.waitForURL(/page=2/u);
  assert.equal(
    await page.evaluate(() => window.__blogNavigationSentinel),
    "retained",
  );
  await page
    .locator("article")
    .first()
    .getByRole("link", { name: "framework", exact: true })
    .click();
  await page.waitForURL(/tag=framework/u);
  assert.equal(new URL(page.url()).searchParams.get("page"), "1");
  await page.locator("article h2 a").first().click();
  await page.waitForURL(/\/posts\//u);
  await page.getByRole("link", { name: "Back to blog" }).waitFor();
  checks.push(
    "SSR, UTC hydration, real pagination/tag/detail links and client navigation",
  );

  await page.goto(base + "/?lang=zh-CN");
  await page.waitForLoadState("networkidle");
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  assert.equal(await page.locator("h1").textContent(), "博客");
  await page.route("**/blog-cover.svg", (route) => route.abort());
  await page.reload();
  await page
    .getByRole("img", { name: "封面暂不可用", exact: true })
    .first()
    .waitFor();
  await page.unroute("**/blog-cover.svg");
  checks.push("nested Chinese locale and image failure fallback");

  await page.goto(base + "/admin");
  await page.waitForLoadState("networkidle");
  const login = async (credential) => {
    await page.getByLabel("Admin token", { exact: true }).fill(credential);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  await login("wrong-token");
  await page
    .getByRole("alert")
    .filter({ hasText: "Sign in with a valid admin token" })
    .waitFor();
  await login(token);
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  await page.getByLabel("Slug", { exact: true }).fill("browser-created");
  await page.getByLabel("Title", { exact: true }).fill("Browser created post");
  await page.getByLabel("Excerpt", { exact: true }).fill("Browser excerpt");
  await page.getByLabel("Content", { exact: true }).fill("Browser content");

  let releaseSave;
  let saveIntercepted;
  const saving = new Promise((resolve) => {
    saveIntercepted = resolve;
  });
  const release = new Promise((resolve) => {
    releaseSave = resolve;
  });
  let posts = 0;
  let failRefresh = true;
  await page.route("**/api/admin/blog**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url());
    if (
      request.method() === "POST" &&
      endpoint.pathname === "/api/admin/blog"
    ) {
      posts += 1;
      saveIntercepted();
      await release;
    } else if (
      failRefresh &&
      posts > 0 &&
      request.method() === "GET" &&
      endpoint.pathname === "/api/admin/blog"
    ) {
      failRefresh = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "owned refresh failure" }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await saving;
  assert.equal(
    await page.getByRole("button", { name: "Save", exact: true }).isDisabled(),
    true,
  );
  releaseSave();
  await page
    .getByRole("alert")
    .filter({ hasText: "The change was saved, but refreshing the list failed" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("status")
      .filter({ hasText: /^Saved$/u })
      .textContent(),
    "Saved",
  );
  assert.equal(
    await page.getByLabel("Title", { exact: true }).inputValue(),
    "",
  );
  assert.equal(posts, 1);
  await page.unroute("**/api/admin/blog**");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .locator("li")
    .filter({ hasText: "Browser created post" })
    .waitFor();
  checks.push(
    "auth, pending disables repeat submit, committed save distinct from refresh failure, real list refresh",
  );

  await page.getByLabel("Title", { exact: true }).fill("Unsaved private form");
  await page.evaluate(() => {
    localStorage.setItem("vext-blog-admin-token", "legacy");
    sessionStorage.setItem("vext-blog-admin-token", "legacy");
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  assert.equal(
    await page.getByLabel("Admin token", { exact: true }).inputValue(),
    "",
  );
  assert.deepEqual(
    await page.evaluate(() => [
      localStorage.getItem("vext-blog-admin-token"),
      sessionStorage.getItem("vext-blog-admin-token"),
    ]),
    [null, null],
  );
  await login(token);
  await page.getByLabel("Title", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Title", { exact: true }).inputValue(),
    "",
  );
  await page.getByLabel("Title", { exact: true }).fill("Clear on unauthorized");
  await page.route("**/api/admin/blog?*", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: '{"message":"expired"}',
    }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByLabel("Admin token", { exact: true }).waitFor();
  await page.unroute("**/api/admin/blog?*");
  await login(token);
  await page.getByLabel("Title", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Title", { exact: true }).inputValue(),
    "",
  );
  checks.push("logout and 401 discard tokens, storage, data and editing state");

  for (const asset of assets) {
    const text = await (await context.request.get(asset)).text();
    assert.equal(
      text.includes(token),
      false,
      "Admin token leaked into browser asset",
    );
    assert.equal(
      text.includes("BACKEND_ONLY_LOCALE"),
      false,
      "Backend locale leaked into browser asset",
    );
  }
  assert.equal(
    requestedUrls.some((url) => url.includes(token)),
    false,
    "Token leaked into URL",
  );
  assert.deepEqual(failures, [], "Browser runtime or hydration errors");
  checks.push("no token in URLs/assets and no runtime/hydration errors");
  process.stdout.write(
    JSON.stringify({ status: "PASS", checks, assetsChecked: assets.size }) +
      "\n",
  );
} finally {
  await browser.close();
}
