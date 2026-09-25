import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import * as rolloutContract from "../website/scripts/docs-rollout.mjs";
import * as documentContract from "../website/scripts/documentation-contract.mjs";
import { parseSpecificationRules } from "../website/scripts/specification-rules.mjs";

await documentContract.loadDocumentationParser();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validator = path.join(
  root,
  "scripts/validation/verify-documentation-contract.mjs",
);
const stage = rolloutContract.resolveDocsRollout();
const original = fs.readFileSync(validator, "utf8");
const code = original
  .slice(
    original.indexOf("const scriptDir ="),
    original.lastIndexOf("\nrunTokenizerSelfTest();"),
  )
  .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(validator).href));
function verify(
  mutate = () => {},
  tail = "verifyRenderedMachineArtifacts(); failures",
  rollout = stage,
  verification = { scope: "stage" },
) {
  const readFileSync = (file, ...args) => {
    const content = fs.readFileSync(file, ...args);
    const filename = String(file).replaceAll("\\", "/");
    if (
      /\/website\/dist\/(?:docs-manifest|spec-rules|ai-gold-questions)\.json$/.test(
        filename,
      )
    ) {
      const artifact = JSON.parse(content);
      mutate(path.basename(filename), artifact);
      return JSON.stringify(artifact);
    }
    return content;
  };
  // Execute the real validator, intercepting only reads. No source/dist mutations.
  return Array.from(
    vm.runInNewContext(
      `${code}\n${tail}`,
      {
        ...fs,
        readFileSync,
        path,
        createHash,
        fileURLToPath,
        spawnSync,
        ...rolloutContract,
        resolveDocsVerification: () => verification,
        resolveDocsRollout: () =>
          rolloutContract.resolveDocsRollout([`--rollout=${rollout}`], {
            VEXT_DOCS_ROLLOUT: rollout,
          }),
        ...documentContract,
        parseSpecificationRules,
        process: {
          ...process,
          argv: ["node", validator, `--rollout=${rollout}`],
          env: { ...process.env, VEXT_DOCS_ROLLOUT: rollout },
        },
        URL,
      },
      { filename: validator },
    ),
  );
}

test("actual rendered validator accepts the freshly built source snapshot", () => {
  assert.deepEqual(verify(), []);
});

test("actual rendered validator rejects missing Rspress home logo navigation", () => {
  const failures = verify(
    undefined,
    `
    const originalRead = readFileSync;
    readFileSync = (file, ...args) => {
      const content = originalRead(file, ...args);
      return String(file).endsWith(".html") && typeof content === "string"
        ? content.replace(/<a\\b[^>]*\\brp-nav__title__link\\b[^>]*>[\\s\\S]*?<\\/a>/g, "")
        : content;
    };
    verifyRenderedMachineArtifacts(); failures`,
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes("navigation is missing home: /zh"),
    ),
    failures.join("\n"),
  );
});

test("actual validator rejects Rule titles, wrong verification scope and duplicate question identity", () => {
  for (const [artifactName, mutate, message] of [
    [
      "spec-rules.json",
      (a) => {
        a.rules[0].title = "wrong";
      },
      "rule differs from source",
    ],
    [
      "docs-manifest.json",
      (a) => {
        a.verification = {
          scope: "page",
          sourcePath: "website/docs/zh/guide/routing.md",
        };
      },
      "differs from current source snapshot",
    ],
    [
      "ai-gold-questions.json",
      (a) => {
        a.questions.push(a.questions[0]);
      },
      "id is missing or duplicated",
    ],
  ]) {
    const failures = verify((name, a) => {
      if (name === artifactName) mutate(a);
    });
    assert.ok(
      failures.some((failure) => failure.includes(message)),
      failures.join("\n"),
    );
  }
});

test("actual source validator allows incremental Chinese and English checks but rejects missing target and wrong roles", () => {
  for (const [rollout, file] of [
    ["zh-complete", "zh/guide/routing.md"],
    ["final", "en/guide/routing.md"],
  ]) {
    assert.deepEqual(
      verify(
        undefined,
        "verifyDocumentationSourceRollout(); failures",
        rollout,
        { scope: "page", sourcePath: `website/docs/${file}` },
      ),
      [],
    );
  }
  const missing = verify(
    undefined,
    `
    // Make the negative fixture independent of which planned pages already exist.
    const entries = documentationSourceEntries().filter(e => !(e.locale === "zh" && e.neutralPath === "specification/architecture.md"));
    documentationSourceEntries = () => entries;
    verifyDocumentationSourceRollout(); failures`,
    "zh-complete",
    {
      scope: "page",
      sourcePath: "website/docs/zh/specification/architecture.md",
    },
  );
  assert.ok(
    missing.some((f) =>
      f.includes("missing required source: zh/specification/architecture.md"),
    ),
  );
  const role = verify(
    undefined,
    `
    const entries = documentationSourceEntries().map(e => e.neutralPath === "guide/error-handling.md" ? { ...e, role: "guide" } : e);
    documentationSourceEntries = () => entries;
    verifyDocumentationSourceRollout(); failures`,
  );
  assert.ok(role.some((f) => f.includes("requires role troubleshooting")));
});
test("shared executable fixtures follow the selected locale and still reject drift at final stage", () => {
  const drift = (locale) => `
    documentedCodeBlock = () => "deliberately stale example";
    verifyDocumentedFixture("website/docs/${locale}/frontend/jscss.md", "start", "end", "test/fixtures/frontend/jscss-user-guide/Button.tsx");
    failures`;
  assert.deepEqual(verify(undefined, drift("en"), "zh-complete"), []);
  assert.ok(
    verify(undefined, drift("zh"), "zh-complete").some((f) =>
      f.includes("drifts from executable fixture"),
    ),
  );
  assert.ok(
    verify(undefined, drift("en"), "final").some((f) =>
      f.includes("drifts from executable fixture"),
    ),
  );
  assert.deepEqual(
    verify(undefined, drift("zh"), "final", {
      scope: "page",
      sourcePath: "website/docs/en/frontend/jscss.md",
    }),
    [],
  );
});

for (const scenario of [
  "one missing",
  "all empty",
  "reverse missing",
  "extra",
  "wrong locale",
])
  test(`actual rendered validator rejects relations: ${scenario}`, () => {
    const failures = verify((name, artifact) => {
      if (name !== "docs-manifest.json") return;
      const source = artifact.entries.find(
        (entry) => entry.relatedDocuments.length,
      );
      if (scenario === "one missing") source.relatedDocuments.pop();
      if (scenario === "all empty")
        for (const entry of artifact.entries) entry.relatedDocuments = [];
      if (scenario === "reverse missing") {
        const targetRef = source.relatedDocuments[0];
        const target = artifact.entries.find(
          (entry) =>
            entry.locale === targetRef.locale &&
            entry.docId === targetRef.docId,
        );
        target.relatedDocuments = target.relatedDocuments.filter(
          (ref) => ref.docId !== source.docId || ref.locale !== source.locale,
        );
      }
      if (scenario === "extra") {
        const extra = artifact.entries.find(
          (entry) =>
            entry !== source &&
            !source.relatedDocuments.some(
              (ref) => ref.docId === entry.docId && ref.locale === entry.locale,
            ),
        );
        source.relatedDocuments.push({
          docId: extra.docId,
          locale: extra.locale,
          canonicalUrl: extra.canonicalUrl,
        });
      }
      if (scenario === "wrong locale")
        source.relatedDocuments[0].locale =
          source.relatedDocuments[0].locale === "en" ? "zh" : "en";
    });
    assert.ok(
      failures.some((failure) =>
        failure.includes("relatedDocuments differ from source links"),
      ),
      failures.join("\n"),
    );
  });
test("actual rendered validator rejects mixed snapshot, missing mandatory Rule and wrong Gold Question locale", () => {
  for (const [artifactName, mutate, diagnostic] of [
    [
      "spec-rules.json",
      (artifact) => {
        artifact.documentationRevision = "old";
      },
      "documentationRevision",
    ],
    [
      "spec-rules.json",
      (artifact) => {
        artifact.rules = artifact.rules.filter(
          (rule) => rule.id !== "VEXT-HTTP-007",
        );
      },
      "required Rule contract",
    ],
    [
      "docs-manifest.json",
      (artifact) => {
        artifact.rollout = "other";
      },
      "rollout",
    ],
    [
      "ai-gold-questions.json",
      (artifact) => {
        const q = artifact.questions.find(
          (q) => q.id === "routing-specification-zh",
        );
        q.locale = "en";
        q.requiredDocIds = ["missing.doc"];
      },
      "unresolved requiredDocId",
    ],
  ]) {
    const failures = verify((name, artifact) => {
      if (name === artifactName) mutate(artifact);
    });
    assert.ok(
      failures.some((failure) => failure.includes(diagnostic)),
      failures.join("\n"),
    );
  }
});
test("actual final source gate rejects an otherwise paired corpus with required specifications omitted", () => {
  const failures = verify(
    undefined,
    `
    const entries = documentationSourceEntries().filter((entry) => !entry.neutralPath.startsWith("specification/"));
    const en = new Map(entries.filter((entry) => entry.locale === "en").map((entry) => [entry.neutralPath, entry]));
    for (const entry of entries) if (en.has(entry.neutralPath)) entry.role = en.get(entry.neutralPath).role;
    documentationSourceEntries = () => entries;
    verifyDocumentationSourceRollout(); failures`,
    "final",
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes("missing required source: en/specification/index.md"),
    ),
  );
  assert.ok(failures.some((failure) => failure.includes("VEXT-CONTRACT-001")));
});
