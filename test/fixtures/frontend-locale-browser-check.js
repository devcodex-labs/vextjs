async (page) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const assets = new Set();
  page.on("response", (response) => {
    if (/\.(js|json)(?:\?|$)/.test(response.url())) assets.add(response.url());
  });
  const require = (value, message) => {
    if (!value) throw new Error(message);
  };
  const base = new URL(page.url()).origin;
  const html = await (await page.request.get(base + "/")).text();
  require(html.includes("<h1>Payment</h1>"), "SSR English text missing");
  require(!html.includes(
    "BACKEND_SECRET_NOT_FOR_BROWSER",
  ), "Backend locale leaked to SSR payload");
  await page.goto(base + "/");
  await page.waitForFunction(() => document.body.dataset.hydrated === "yes");
  require((await page.locator("h1").textContent()) ===
    "Payment", "Hydration changed English locale");
  await page.locator("#counter").click();
  require((await page.locator("#counter").textContent()) ===
    "1", "Hydrated event handler inactive");
  await page.locator("#chinese").click();
  await page.waitForFunction(
    () =>
      document.body.dataset.hydrated === "yes" &&
      document.querySelector("h1").textContent === "支付",
  );
  require((await page.locator("html").getAttribute("lang")) ===
    "zh-CN", "Chinese html lang mismatch");
  await page.evaluate(() => {
    window.__localeNavigationSentinel = "retained";
  });
  await page.locator("#next").click();
  await page.waitForFunction(
    () => document.querySelector("#path").textContent === "/next",
  );
  require((await page.evaluate(() => window.__localeNavigationSentinel)) ===
    "retained", "Link navigation unexpectedly reloaded the document");
  require((await page.locator("h1").textContent()) ===
    "支付", "Navigation lost nested locale");
  for (const url of assets) {
    const text = await (await page.request.get(url)).text();
    require(!text.includes(
      "BACKEND_SECRET_NOT_FOR_BROWSER",
    ), "Backend locale leaked to browser asset: " + url);
  }
  require(failures.length === 0, "Browser runtime error: " +
    failures.join("; "));
  await page.screenshot({ path: "output/playwright/locale-browser.png" });
  return {
    status: "PASS",
    checks: [
      "SSR",
      "hydration",
      "interactive state",
      "reload locale switch",
      "html lang",
      "client navigation",
      "nested locale",
      "no backend locale leakage",
    ],
    browserAssetsChecked: assets.size,
  };
};
