async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const equal = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(label + ": " + JSON.stringify({ actual, expected }));
  };
  await page.goto(page.url().split("#")[0]);
  await page.locator("#vext-docs-auth > summary").click();
  await page.getByPlaceholder("Bearer token").fill("fixture-token-a");
  const panel = page.locator(".vext-docs-tryout").first();
  await panel.locator("summary").first().click();
  await panel.getByRole("tab", { name: "Body", exact: true }).click();
  console.log(await panel.ariaSnapshot());
  const media = panel.getByRole("combobox", {
    name: "Content type",
    exact: true,
  });
  const body = panel.getByRole("textbox", {
    name: "Request body",
    exact: true,
  });
  equal(await media.inputValue(), "text/plain", "default media");
  const send = async () => {
    const responsePromise = page.waitForResponse(
      (r) => /\/(echo|other)$/.test(r.url()) && r.request().method() === "POST",
    );
    await panel.getByRole("button", { name: "Send", exact: true }).click();
    return (await responsePromise).json();
  };
  equal((await send()).body, "123", "numeric text stays text");
  await panel.getByRole("tab", { name: "Body", exact: true }).click();
  await body.fill("  \n ");
  equal((await send()).body, "  \n ", "whitespace preserved");
  await panel.getByRole("tab", { name: "Body", exact: true }).click();
  await media.selectOption("application/json");
  const json = await send();
  equal(JSON.parse(json.body), { title: "Vext" }, "JSON body");
  equal(json.contentType, "application/json", "JSON media");
  equal(json.authorization, "Bearer fixture-token-a", "first auth");
  await page.getByPlaceholder("Bearer token").fill("fixture-token-b");
  await panel.getByRole("tab", { name: "Body", exact: true }).click();
  await media.selectOption("application/x-www-form-urlencoded");
  const form = await send();
  equal(
    form.body,
    "title=%E4%BD%A0%E5%A5%BD+world&tag=a&tag=b",
    "form encoding",
  );
  equal(form.authorization, "Bearer fixture-token-b", "edited auth");
  await panel.getByRole("tab", { name: "Body", exact: true }).click();
  await media.selectOption("multipart/form-data");
  const requestsUrl = page.url().split("/").slice(0, 3).join("/") + "/requests";
  const before = await (await page.request.get(requestsUrl)).json();
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  if (!(await panel.textContent()).includes("no request was sent"))
    throw new Error("unsupported media notice missing");
  equal(
    await (await page.request.get(requestsUrl)).json(),
    before,
    "multipart not sent",
  );
  await page.getByRole("button", { name: "POST /other", exact: true }).click();
  console.log(await page.locator("#vext-docs-panel").ariaSnapshot());
  const other = page.locator(".vext-docs-tryout").last();
  await other.locator("summary").first().click();
  await page
    .getByRole("button", { name: "Clear credentials", exact: true })
    .click();
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith("/other") && r.request().method() === "POST",
  );
  await other.getByRole("button", { name: "Send", exact: true }).click();
  equal(
    (await (await responsePromise).json()).authorization,
    null,
    "clear after navigation",
  );
  equal(errors, [], "browser errors");
  console.log(
    JSON.stringify({
      passed: [
        "numeric text",
        "whitespace",
        "JSON",
        "form arrays/unicode",
        "edit auth",
        "unsupported media",
        "navigation/clear auth",
        "no pageerror",
      ],
    }),
  );
  await page.screenshot({
    path: "output/playwright/docs-browser.png",
    fullPage: true,
  });
};
