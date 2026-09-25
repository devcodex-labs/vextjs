import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  resolveDocsRollout,
  resolveDocsVerification,
  assertPublishable,
  requiredPages,
  requiredRules,
  validateRequiredInventory,
} from "../website/scripts/docs-rollout.mjs";
import {
  loadDocumentationParser,
  documentationRouteForSource,
  documentationHtmlPath,
  documentationLinks,
  documentationRelations,
  validateDocumentationRelations,
  documentationRevision,
  documentationText,
  validateGoldQuestionMirrors,
} from "../website/scripts/documentation-contract.mjs";
import {
  metadataForSource,
  ruleRecordsForEntry,
} from "../website/scripts/generate-machine-artifacts.mjs";
await loadDocumentationParser();

function entry(locale, file, source = "") {
  const route = documentationRouteForSource(`${locale}/${file}`);
  return {
    locale,
    docId: file.replace(/\.mdx?$/, "").replaceAll("/", "."),
    sourcePath: `website/docs/${locale}/${file}`,
    route,
    canonicalUrl: `https://example.test${route}`,
    source,
  };
}
const ref = ({ docId, locale, canonicalUrl }) => ({
  docId,
  locale,
  canonicalUrl,
});

test("default identity preserves nested index and explicit identity survives moves; role owns rule extraction", () => {
  assert.deepEqual(metadataForSource("zh/specification/index.md", "# 规范"), {
    docId: "specification.index",
    role: "specification",
  });
  assert.deepEqual(
    metadataForSource(
      "en/moved/path.mdx",
      "---\ndocId: guide.routing\nrole: specification\n---\n",
    ),
    { docId: "guide.routing", role: "specification" },
  );
  const source =
    '<a id="vext-http-001"></a>\n\n### VEXT-HTTP-001 [MUST] Contract\n\nText\n';
  const outsideDirectory = {
    ...entry("zh", "frontend/boundaries-and-roadmap.md", source),
    role: "specification",
  };
  assert.equal(ruleRecordsForEntry(outsideDirectory)[0].id, "VEXT-HTTP-001");
  assert.deepEqual(
    ruleRecordsForEntry({ ...outsideDirectory, role: "guide" }),
    [],
  );
  assert.deepEqual(
    ruleRecordsForEntry({ ...outsideDirectory, source: "# Overview\n" }),
    [],
  );
});

test("rollout is deterministic, validates CLI and environment without ambient defaults", () => {
  assert.equal(resolveDocsRollout([], {}), "final");
  assert.equal(
    resolveDocsRollout(["--rollout", "zh-complete"], {}),
    "zh-complete",
  );
  assert.equal(
    resolveDocsRollout(["--rollout=zh-routing-pilot"], {
      VEXT_DOCS_ROLLOUT: "zh-routing-pilot",
    }),
    "zh-routing-pilot",
  );
  assert.equal(resolveDocsRollout([], { VEXT_DOCS_ROLLOUT: "final" }), "final");
  for (const [args, env] of [
    [["--rollout=final"], { VEXT_DOCS_ROLLOUT: "zh-complete" }],
    [["--rollout"], {}],
    [["--rollout="], {}],
    [["--rollout=other"], {}],
    [[], { VEXT_DOCS_ROLLOUT: "other" }],
    [["--rollout=final", "--rollout=final"], {}],
  ])
    assert.throws(() => resolveDocsRollout(args, env));
  assert.doesNotThrow(() => assertPublishable("final"));
  for (const rollout of ["zh-routing-pilot", "zh-complete"]) {
    assert.throws(() => assertPublishable(rollout), /not publishable/);
    const child = spawnSync(
      process.execPath,
      ["website/scripts/run-docs.mjs", "publish", `--rollout=${rollout}`],
      { encoding: "utf8", env: { ...process.env, VEXT_DOCS_ROLLOUT: rollout } },
    );
    assert.equal(child.status, 1);
    assert.match(child.stderr, /not publishable/);
  }
});

test("machine titles retain inline code symbols and remove Markdown and HTML presentation", () => {
  assert.equal(
    documentationText(
      "Use `app.*` and `a > b` with `req.valid<T>()`, **names** and <em>values</em> [here](/guide).",
    ),
    "Use app.* and a > b with req.valid<T>(), names and values here.",
  );
  const source =
    '<a id="vext-http-001"></a>\n\n### VEXT-HTTP-001 [MUST] Keep `name_with_underscore` and `#`\n\nText\n';
  const records = ruleRecordsForEntry({
    ...entry("zh", "specification/http-and-routing.md", source),
    role: "specification",
  });
  assert.equal(records[0].title, "Keep name_with_underscore and #");
});

test("page scope is explicit, bounded and never publishable, including during English translation", () => {
  assert.deepEqual(resolveDocsVerification([], {}), { scope: "stage" });
  const scope = resolveDocsVerification(
    ["--rollout=final", "--page=en/guide/routing.md"],
    {},
  );
  assert.deepEqual(scope, {
    scope: "page",
    sourcePath: "website/docs/en/guide/routing.md",
  });
  assert.throws(() => assertPublishable("final", scope), /not publishable/);
  for (const [args, env] of [
    [["--page"], {}],
    [["--page="], {}],
    [["--page=../escape.md"], {}],
    [["--page=zh/guide/routing.md", "--page=zh/guide/routing.md"], {}],
    [
      ["--page=zh/guide/routing.md"],
      { VEXT_DOCS_PAGE: "zh/guide/middleware.md" },
    ],
    [["--rollout=zh-complete", "--page=en/guide/routing.md"], {}],
    [["--rollout=zh-routing-pilot", "--page=zh/guide/jobs.md"], {}],
  ])
    assert.throws(() => resolveDocsVerification(args, env));
  const child = spawnSync(
    process.execPath,
    [
      "website/scripts/run-docs.mjs",
      "publish",
      "--rollout=final",
      "--page=en/guide/routing.md",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        VEXT_DOCS_ROLLOUT: "final",
        VEXT_DOCS_PAGE: "en/guide/routing.md",
      },
    },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /not publishable/);
});

test("frontmatter identity overrides reject empty, repeated and compound values with source context", () => {
  for (const declaration of [
    "role:",
    "docId:",
    "docId: null",
    "docId: true",
    "docId: false",
    "role: guide\nrole: reference",
    "docId: a\ndocId: b",
    "role: []",
    "docId: |\n  guide.routing",
    'role: ""',
  ]) {
    assert.throws(
      () =>
        metadataForSource(
          "zh/guide/routing.md",
          `---\n${declaration}\n---\n# 路由`,
        ),
      /website\/docs\/zh\/guide\/routing.md/,
    );
  }
  assert.deepEqual(
    metadataForSource(
      "zh/guide/routing.md",
      "\uFEFF---\nrole: \"reference\" # override\ndocId: 'guide.stable'\n---",
    ),
    { role: "reference", docId: "guide.stable" },
  );
});

test("a first new Chinese page and a first English mirror can pass independently while the stage remains incomplete", () => {
  for (const rollout of ["zh-complete", "final"]) {
    const page = {
      scope: "page",
      sourcePath: `website/docs/${rollout === "final" ? "en" : "zh"}/specification/architecture.md`,
    };
    const entries = (rollout === "final" ? ["en", "zh"] : ["zh"]).map(
      (locale) => ({
        locale,
        neutralPath: "specification/architecture.md",
        docId: "specification.architecture",
        role: "specification",
      }),
    );
    const nav = new Set(
      entries.map(
        (e) => `${e.locale === "zh" ? "/zh" : ""}/specification/architecture`,
      ),
    );
    assert.deepEqual(
      validateRequiredInventory(rollout, entries, [], nav, page),
      [],
    );
    assert.ok(validateRequiredInventory(rollout, entries, [], nav).length);
    assert.ok(validateRequiredInventory(rollout, [], [], nav, page).length);
    assert.ok(
      validateRequiredInventory(rollout, entries, [], new Set(), page).length,
    );
  }
  const page = {
    scope: "page",
    sourcePath: "website/docs/zh/guide/error-handling.md",
  };
  assert.ok(
    validateRequiredInventory(
      "zh-complete",
      [{ locale: "zh", neutralPath: "guide/error-handling.md", role: "guide" }],
      [],
      undefined,
      page,
    ).some((x) => x.includes("requires role troubleshooting")),
  );
});

test("page scope preserves required rule identity and accepts MDX home navigation", () => {
  const page = {
    scope: "page",
    sourcePath: "website/docs/zh/specification/http-and-routing.md",
  };
  const entries = [
    {
      locale: "zh",
      neutralPath: "specification/http-and-routing.md",
      docId: "renamed",
      role: "specification",
    },
  ];
  assert.equal(
    validateRequiredInventory(
      "zh-routing-pilot",
      entries,
      [],
      undefined,
      page,
    ).filter((x) => x.includes("required Rule contract")).length,
    10,
  );
  assert.deepEqual(
    validateRequiredInventory(
      "zh-complete",
      [
        {
          locale: "zh",
          neutralPath: "index.mdx",
          docId: "index",
          role: "resource",
        },
      ],
      [],
      new Set(["/zh"]),
      { scope: "page", sourcePath: "website/docs/zh/index.mdx" },
    ),
    [],
  );
});

test("root and nested index routes map to Rspress directory HTML, ordinary routes keep .html", () => {
  for (const [source, route, html] of [
    ["en/index.mdx", "/", "index.html"],
    ["zh/index.mdx", "/zh/", "zh/index.html"],
    [
      "zh/specification/index.md",
      "/zh/specification/",
      "zh/specification/index.html",
    ],
    [
      "en/specification/index.md",
      "/specification/",
      "specification/index.html",
    ],
    ["zh/guide/routing.md", "/zh/guide/routing", "zh/guide/routing.html"],
  ]) {
    assert.equal(documentationRouteForSource(source), route);
    assert.equal(documentationHtmlPath("dist", route), path.join("dist", html));
  }
});

test("Markdown AST supports inline and reference forms, ignoring code, comments, images and unused definitions", () => {
  const source =
    '---\nexample: "[bad](/bad)"\n---\n[a](./a.md "Title") [b][B] [c][] [d]\n\n[b]: ./b.md\n[c]: ./c.md\n[d]: ./d.md\n[unused]: ./absent.md\n\n`[bad](/bad)` `` `[bad](/bad)` ``\n\n```md\n[bad](/bad)\n```\n\n<!-- [bad](/bad) -->\n\n![bad](/bad.png)\n\n<a href="./e.md">E</a>';
  assert.deepEqual(documentationLinks(source), [
    "./a.md",
    "./b.md",
    "./c.md",
    "./d.md",
    "./e.md",
  ]);
});

test("MDX home links preserve the declared locale without executing expressions", () => {
  for (const prefix of ["", "/zh"]) {
    const declaration =
      "export const docsHref = (path) => `${basePath}" + prefix + "${path}`;";
    const source =
      declaration +
      '\n\n<a href={docsHref("/guide/routing.html")}>Routing</a>\n\n' +
      '<a href={"/zh/api/config"}>Config</a>\n\n' +
      "```mdx\n<a href={untrusted()}>Ignored code</a>\n```\n\n" +
      "<!-- <a href={untrusted()}>Ignored comment</a> -->";
    assert.deepEqual(documentationLinks(source), [
      prefix + "/guide/routing.html",
      "/zh/api/config",
    ]);
  }
  assert.throws(() =>
    documentationLinks(
      '<a href={docsHref("/guide/routing")}>Missing helper</a>',
    ),
  );
  assert.throws(() =>
    documentationLinks(
      '```js\nexport const docsHref = (path) => `${basePath}${path}`;\n```\n\n<a href={docsHref("/guide/routing")}>Fake helper</a>',
    ),
  );
  assert.throws(() =>
    documentationLinks("<a href={computePath()}>Dynamic</a>"),
  );
});

test("relations use source directories and actual absolute locale, and include incoming union", () => {
  const home = entry(
    "zh",
    "index.mdx",
    "[nested](./specification/index.md) [routing](./guide/routing.md)",
  );
  const index = entry(
    "zh",
    "specification/index.md",
    "[http][h]\n\n[h]: ./http-and-routing.md\n",
  );
  const http = entry(
    "zh",
    "specification/http-and-routing.md",
    "[routing](../guide/routing.md?q=1#test) [en](/guide/routing) [self](./http-and-routing.md) [asset](/files/data.json) [external](https://example.test/foo)",
  );
  const zh = entry("zh", "guide/routing.md");
  const en = entry("en", "guide/routing.md");
  const isolated = entry("en", "guide/isolated.md");
  const sources = [home, index, http, zh, en, isolated];
  const relations = documentationRelations(sources);
  assert.deepEqual(relations.get(index.sourcePath), [ref(home), ref(http)]);
  assert.deepEqual(relations.get(zh.sourcePath), [ref(home), ref(http)]);
  assert.deepEqual(relations.get(en.sourcePath), [ref(http)]);
  assert.deepEqual(relations.get(isolated.sourcePath), []);
  const actual = sources.map((entry) => ({
    ...entry,
    relatedDocuments: relations.get(entry.sourcePath),
  }));
  assert.deepEqual(validateDocumentationRelations(actual, sources), []);
  for (const mutate of [
    (entries) => {
      entries[0].relatedDocuments.pop();
    },
    (entries) => {
      for (const e of entries) e.relatedDocuments = [];
    },
    (entries) => {
      entries[4].relatedDocuments = [];
    }, // remove only incoming reverse edge
    (entries) => {
      entries[5].relatedDocuments.push(ref(zh));
    },
    (entries) => {
      entries[1].relatedDocuments[0].locale = "en";
    },
  ]) {
    const altered = structuredClone(actual);
    mutate(altered);
    assert.ok(validateDocumentationRelations(altered, sources).length);
  }
  for (const source of [
    "[missing](./missing.md)",
    "[missing][m]\n\n[m]: ./missing.md",
  ])
    assert.throws(
      () => documentationRelations([entry("zh", "index.mdx", source)]),
      /Unresolved.*missing/,
    );
  assert.throws(
    () => documentationRelations([entry("zh", "specification.md"), index]),
    /Duplicate documentation route/,
  );
});

for (const rollout of ["zh-routing-pilot", "zh-complete", "final"])
  test(`${rollout} requires every page, rule and navigation entry, even if both locales omit it`, () => {
    const entries = requiredPages(rollout).map((e) => ({
      ...e,
      role:
        e.neutralPath === "guide/error-handling.md"
          ? "troubleshooting"
          : e.neutralPath.startsWith("specification/")
            ? "specification"
            : e.neutralPath.startsWith("api/")
              ? "reference"
              : "guide",
    }));
    if (rollout !== "zh-routing-pilot")
      for (const locale of rollout === "final" ? ["en", "zh"] : ["zh"])
        entries.push(
          {
            locale,
            neutralPath: "frontend/troubleshooting.md",
            role: "troubleshooting",
          },
          {
            locale,
            neutralPath: "frontend/boundaries-and-roadmap.md",
            role: "specification",
          },
        );
    const rules = requiredRules(rollout);
    const nav = new Set(
      entries.map((e) =>
        documentationRouteForSource(`${e.locale}/${e.neutralPath}`).replace(
          /\/$/,
          "",
        ),
      ),
    );
    assert.deepEqual(
      validateRequiredInventory(rollout, entries, rules, nav),
      [],
    );
    for (let i = 0; i < entries.length; i++)
      assert.ok(
        validateRequiredInventory(
          rollout,
          entries.filter((_, j) => i !== j),
          rules,
          nav,
        ).length,
      );
    for (let i = 0; i < rules.length; i++)
      assert.ok(
        validateRequiredInventory(
          rollout,
          entries,
          rules.filter((_, j) => i !== j),
          nav,
        ).length,
      );
    for (const route of nav) {
      if (route.includes("/frontend/")) continue;
      const missing = new Set(nav);
      missing.delete(route);
      assert.ok(
        validateRequiredInventory(rollout, entries, rules, missing).length,
      );
    }
    assert.ok(validateRequiredInventory(rollout, [], [], new Set()).length);
  });

test("future consumer fixture uses precise document/locale/rule identity and rejects mixed snapshots", () => {
  const document = {
    ...entry("zh", "specification/http-and-routing.md"),
    contentHash: "a".repeat(64),
  };
  const revision = documentationRevision([document], {
    rollout: "zh-routing-pilot",
  });
  const manifest = { documentationRevision: revision, entries: [document] };
  const rules = {
    documentationRevision: revision,
    rules: [{ id: "VEXT-HTTP-001", locale: "zh", docId: document.docId }],
  };
  // Test-only example consumer: no capability catalog or runtime provider.
  const join = (reference, ruleArtifact = rules) => {
    assert.equal(
      manifest.documentationRevision,
      ruleArtifact.documentationRevision,
      "mixed snapshots",
    );
    const result = manifest.entries.find(
      (entry) =>
        entry.docId === reference.docId && entry.locale === reference.locale,
    );
    assert.ok(result, "document unavailable in requested locale");
    if (reference.ruleId)
      assert.ok(
        ruleArtifact.rules.some(
          (rule) =>
            rule.id === reference.ruleId &&
            rule.docId === result.docId &&
            rule.locale === reference.locale,
        ),
        "rule unavailable",
      );
    return result;
  };
  const reference = {
    docId: document.docId,
    locale: "zh",
    ruleId: "VEXT-HTTP-001",
  };
  assert.equal(join(reference), document);
  assert.throws(() => join({ ...reference, docId: "missing" }));
  assert.throws(() => join({ ...reference, locale: "en" }));
  assert.throws(() => join({ ...reference, ruleId: "VEXT-HTTP-999" }));
  assert.throws(() =>
    join(reference, { ...rules, documentationRevision: "old" }),
  );
  assert.notEqual(
    revision,
    documentationRevision([{ ...document, contentHash: "b".repeat(64) }], {
      rollout: "zh-routing-pilot",
    }),
  );
});

test("Gold Questions permit pilot locale coverage differences but require final mirror equivalence", () => {
  const pair = [
    {
      id: "routing",
      question: "How do I define a route?",
      locale: "en",
      requiredRoutes: ["/guide/routing"],
      requiredDocIds: ["guide.routing"],
    },
    {
      id: "routing-zh",
      question: "如何定义路由？",
      locale: "zh",
      requiredRoutes: ["/zh/guide/routing"],
      requiredDocIds: ["guide.routing", "specification.http-and-routing"],
    },
  ];
  assert.deepEqual(validateGoldQuestionMirrors(pair, "zh-routing-pilot"), []);
  assert.equal(validateGoldQuestionMirrors(pair, "final").length, 1);
  pair[0].requiredDocIds = [...pair[1].requiredDocIds].reverse();
  assert.deepEqual(validateGoldQuestionMirrors(pair, "final"), []);
  assert.equal(validateGoldQuestionMirrors(pair.slice(1), "final").length, 1);
});

test("Chinese stage requires Chinese document IDs while English translation remains deferred", () => {
  const en = {
    id: "sample",
    question: "Route?",
    locale: "en",
    requiredRoutes: ["/guide/routing"],
  };
  const zh = {
    id: "sample-zh",
    question: "路由？",
    locale: "zh",
    requiredRoutes: ["/zh/guide/routing"],
  };
  assert.deepEqual(
    validateGoldQuestionMirrors([en, zh], "zh-routing-pilot"),
    [],
  );
  assert.ok(
    validateGoldQuestionMirrors([en, zh], "zh-complete").some((failure) =>
      failure.includes("sample-zh"),
    ),
  );
  zh.requiredDocIds = ["guide.routing"];
  assert.deepEqual(validateGoldQuestionMirrors([en, zh], "zh-complete"), []);
  assert.ok(
    validateGoldQuestionMirrors([en, zh], "final").some((failure) =>
      failure.includes("missing requiredDocIds"),
    ),
  );
});

test("Gold Question identity, locale and collections are validated even in page scope", () => {
  const q = {
    id: "sample",
    question: "如何定义路由？",
    locale: "zh",
    requiredRoutes: ["/zh/guide/routing"],
    requiredDocIds: ["guide.routing"],
  };
  const page = {
    scope: "page",
    sourcePath: "website/docs/zh/guide/routing.md",
  };
  assert.deepEqual(validateGoldQuestionMirrors([q], "final", page), []);
  for (const questions of [
    [q, q],
    [{ ...q, question: "  " }],
    [{ ...q, question: 4 }],
    [{ ...q, locale: "fr" }],
    [{ ...q, requiredRoutes: [] }],
    [{ ...q, requiredRoutes: ["/a", "/a"] }],
    [{ ...q, requiredDocIds: [4] }],
  ])
    assert.ok(validateGoldQuestionMirrors(questions, "final", page).length);
});
