export const docsRollouts = Object.freeze([
  "zh-routing-pilot",
  "zh-complete",
  "final",
]);

export function resolveDocsRollout(
  argv = process.argv.slice(2),
  env = process.env,
) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--rollout") values.push(argv[++i]);
    else if (argv[i].startsWith("--rollout=")) values.push(argv[i].slice(10));
  }
  if (values.length > 1) throw new Error("Duplicate --rollout argument");
  const cli = values[0];
  const environment = env.VEXT_DOCS_ROLLOUT;
  for (const value of [
    ...values,
    ...(environment === undefined ? [] : [environment]),
  ]) {
    if (!docsRollouts.includes(value))
      throw new Error(`Unsupported documentation rollout: ${String(value)}`);
  }
  if (cli !== undefined && environment !== undefined && cli !== environment) {
    throw new Error(
      `Documentation rollout conflict: CLI=${cli}, ENV=${environment}`,
    );
  }
  return cli ?? environment ?? "final";
}

export function resolveDocsVerification(
  argv = process.argv.slice(2),
  env = process.env,
  rollout = resolveDocsRollout(argv, env),
) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--page") values.push(argv[++i]);
    else if (argv[i].startsWith("--page=")) values.push(argv[i].slice(7));
  }
  if (values.length > 1) throw new Error("Duplicate --page argument");
  const environment = env.VEXT_DOCS_PAGE;
  for (const value of [
    ...values,
    ...(environment === undefined ? [] : [environment]),
  ]) {
    if (
      typeof value !== "string" ||
      !/^(en|zh)\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.mdx?$/.test(value)
    )
      throw new Error(`Invalid documentation page: ${String(value)}`);
  }
  if (
    values[0] !== undefined &&
    environment !== undefined &&
    values[0] !== environment
  )
    throw new Error(
      `Documentation page conflict: CLI=${values[0]}, ENV=${environment}`,
    );
  const page = values[0] ?? environment;
  if (page === undefined) return { scope: "stage" };
  const [locale, ...segments] = page.split("/");
  if (rollout !== "final" && locale !== "zh")
    throw new Error(`Documentation rollout ${rollout} requires a Chinese page`);
  if (
    rollout === "zh-routing-pilot" &&
    !pilotPaths.includes(segments.join("/"))
  )
    throw new Error(`Documentation page is outside the routing pilot: ${page}`);
  return { scope: "page", sourcePath: `website/docs/${page}` };
}

export function assertPublishable(rollout, verification = { scope: "stage" }) {
  if (rollout !== "final" || verification.scope !== "stage")
    throw new Error(
      `Documentation rollout ${rollout}/${verification.scope} is not publishable; final stage verification is required`,
    );
}

export const pilotPaths = Object.freeze([
  "specification/http-and-routing.md",
  "guide/routing.md",
  "guide/middleware.md",
  "api/route-definition.md",
  "guide/error-handling.md",
]);
export const addedPaths = Object.freeze([
  "specification/index.md",
  "specification/architecture.md",
  "specification/http-and-routing.md",
  "specification/validation-and-contracts.md",
  "specification/data-access.md",
  "specification/security-and-resources.md",
  "specification/jobs.md",
  "specification/operations.md",
  "guide/security.md",
  "guide/rate-limit.md",
  "guide/uploads.md",
]);
export function allowedMirrorGaps(rollout) {
  return new Set(
    rollout === "zh-routing-pilot"
      ? [addedPaths[2]]
      : rollout === "zh-complete"
        ? addedPaths
        : [],
  );
}
export function requiredPages(rollout, verification = { scope: "stage" }) {
  if (verification.scope === "page") {
    const [locale, ...segments] = verification.sourcePath
      .replace(/^website\/docs\//, "")
      .split("/");
    return (rollout === "final" ? ["en", "zh"] : [locale]).map((language) => ({
      locale: language,
      neutralPath: segments.join("/"),
    }));
  }
  const locales = rollout === "final" ? ["en", "zh"] : ["zh"];
  const paths =
    rollout === "zh-routing-pilot"
      ? pilotPaths
      : [...new Set([...pilotPaths, ...addedPaths])];
  return locales.flatMap((locale) =>
    paths.map((neutralPath) => ({ locale, neutralPath })),
  );
}
export function requiredRules(rollout, verification = { scope: "stage" }) {
  const locales = rollout === "final" ? ["en", "zh"] : ["zh"];
  const httpLevels = [
    "must",
    "must",
    "should",
    "must",
    "must-not",
    "should",
    "must",
    "should",
    "must-not",
    "must",
  ];
  const rules = httpLevels.map((level, i) => ({
    id: `VEXT-HTTP-${String(i + 1).padStart(3, "0")}`,
    level,
    docId: "specification.http-and-routing",
  }));
  if (rollout !== "zh-routing-pilot")
    rules.push({
      id: "VEXT-CONTRACT-001",
      level: "must-not",
      docId: "specification.validation-and-contracts",
    });
  const all = locales.flatMap((locale) =>
    rules.map((rule) => ({ ...rule, locale })),
  );
  if (verification.scope !== "page") return all;
  const pages = requiredPages(rollout, verification);
  return all.filter((rule) =>
    pages.some(
      (page) =>
        page.locale === rule.locale &&
        page.neutralPath.replace(/\.mdx?$/, "").replaceAll("/", ".") ===
          rule.docId,
    ),
  );
}

export function requiredRoleOverrides(
  rollout,
  verification = { scope: "stage" },
) {
  const paths = [
    ["guide/error-handling.md", "troubleshooting"],
    ...(rollout === "zh-routing-pilot"
      ? []
      : [
          ["frontend/troubleshooting.md", "troubleshooting"],
          ["frontend/boundaries-and-roadmap.md", "specification"],
        ]),
  ];
  const locales = rollout === "final" ? ["en", "zh"] : ["zh"];
  const roles = locales.flatMap((locale) =>
    paths.map(([neutralPath, role]) => ({ locale, neutralPath, role })),
  );
  return verification.scope === "stage"
    ? roles
    : roles.filter((item) =>
        requiredPages(rollout, verification).some(
          (page) =>
            page.locale === item.locale &&
            page.neutralPath === item.neutralPath,
        ),
      );
}
export function validateRequiredInventory(
  rollout,
  entries,
  rules,
  navigationRoutes,
  verification = { scope: "stage" },
) {
  const failures = [];
  for (const required of requiredPages(rollout, verification)) {
    const source = `${required.locale}/${required.neutralPath}`;
    if (
      !entries.some(
        (entry) =>
          entry.locale === required.locale &&
          entry.neutralPath === required.neutralPath,
      )
    ) {
      failures.push(`rollout ${rollout} is missing required source: ${source}`);
    }
    const route = `/${required.locale === "zh" ? "zh/" : ""}${required.neutralPath.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "$1")}`;
    if (
      navigationRoutes &&
      !navigationRoutes.has(route.replace(/\/$/, "") || "/")
    ) {
      failures.push(
        `rollout ${rollout} is missing required navigation: ${route}`,
      );
    }
  }
  for (const required of requiredRules(rollout, verification)) {
    if (
      !rules.some(
        (rule) =>
          rule.id === required.id &&
          rule.locale === required.locale &&
          rule.level === required.level &&
          rule.docId === required.docId,
      )
    ) {
      failures.push(
        `rollout ${rollout} is missing required Rule contract: ${required.id}:${required.locale}`,
      );
    }
  }
  for (const required of requiredRoleOverrides(rollout, verification)) {
    if (
      !entries.some(
        (entry) =>
          entry.locale === required.locale &&
          entry.neutralPath === required.neutralPath &&
          entry.role === required.role,
      )
    )
      failures.push(
        `rollout ${rollout} requires role ${required.role}: ${required.locale}/${required.neutralPath}`,
      );
  }
  return failures;
}
