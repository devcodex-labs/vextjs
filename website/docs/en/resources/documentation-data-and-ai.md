---
title: Documentation Data and AI
description: Documentation identity, rule indexes, locale and snapshot contracts, and the documentation reference boundary for a future knowledge graph.
---

# Documentation Data and AI

VextJS provides both pages for readers and deterministic build artifacts. This makes search, AI-assisted analysis, and documentation quality checks more reliable. `website/docs` owns the content; machine artifacts help locate and validate references but cannot replace reading the pages and checking implementation.

This page is for developers of search, AI answers, and a future knowledge graph. Choose an asset, read it by identity and snapshot, then verify answer boundaries. The current deliverable is a documentation-side contract, not an implemented Capability Graph or project compliance check.

## Public machine-readable assets

These links point to the formal site. For a local preview of the Chinese stage, read the corresponding files from that local build; do not assume the current changes have been deployed. Inspect the actual `schemaVersion`, `rollout`, and `verification` before integration.

| Asset                                                                                                     | Purpose                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [`docs-manifest.json`](https://devcodex-labs.github.io/vextjs/docs-manifest.json)                         | `vext.docs-manifest/v2`: document identity, role, locale, URL, source hash, and relationship index.                         |
| [`capabilities.json`](https://devcodex-labs.github.io/vextjs/capabilities.json)                           | Existing v1 capability summary and non-goals, not complete capability definitions or a graph; read details and limitations. |
| [`ai-gold-questions.json`](https://devcodex-labs.github.io/vextjs/ai-gold-questions.json)                 | Questions, required documents/routes, and forbidden claims for answer regression. Structural checks do not prove semantics. |
| [`llms.txt`](https://devcodex-labs.github.io/vextjs/llms.txt)                                             | Concise English entry points for language models and documentation tools. It is an index, not a crawler-control file.       |
| [`llms-full.txt`](https://devcodex-labs.github.io/vextjs/llms-full.txt)                                   | Complete English URL-and-summary index: every public English documentation page appears exactly once.                       |
| [`zh/llms.txt`](https://devcodex-labs.github.io/vextjs/zh/llms.txt)                                       | Concise Simplified Chinese entry points, isolated from the default English index.                                           |
| [`zh/llms-full.txt`](https://devcodex-labs.github.io/vextjs/zh/llms-full.txt)                             | Complete Simplified Chinese URL-and-summary index: every public Chinese documentation page appears exactly once.            |
| [`docs-events.schema.json`](https://devcodex-labs.github.io/vextjs/docs-events.schema.json)               | Optional privacy-preserving event contract. No collector is enabled by VextJS.                                              |
| [`docs-dashboard-definition.json`](https://devcodex-labs.github.io/vextjs/docs-dashboard-definition.json) | Metric definitions and collection boundary for a site owner who later chooses a compliant collector.                        |

The build also generates [`spec-rules.json`](https://devcodex-labs.github.io/vextjs/spec-rules.json), with `schemaVersion: vext.spec-rules/v1`, projecting rule identities, levels, and links from Specification pages.

The manifest, rules, and llms indexes are generated after the site build without build timestamps. Their output is repeatable when document sources, build contracts, navigation, question set, lockfile, and site configuration are fixed. Capabilities, questions, and metrics contracts are public source assets; do not mistake them for data wholly extracted from page prose.

## Language and completeness contract

All four `llms*.txt` files are deterministic UTF-8 Markdown served as plain
text. The root files contain English only; files under `/zh/` contain Simplified
Chinese. `llms.txt` is intentionally curated so a model can find the main
reading paths without loading the whole site. `llms-full.txt` is the exhaustive
index for its locale, with one canonical URL and source-derived summary for
every page. `docs-manifest.json` remains the authoritative bilingual inventory
and records each entry's locale and source hash; the build verifies exact
per-locale coverage.

The “full” files are complete indexes, not copies of every page body. A
web-capable assistant follows the canonical URLs to the rendered documentation;
an offline tool can use the manifest and indexes to choose the exact pages it
needs. This keeps the machine entry small enough to parse while preserving
1:1, build-verified coverage.

## Document Identity and Roles

Core `manifest.entries` fields:

| Field                                  | Meaning for consumers                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `docId` + `locale`                     | Exact unique key, such as `guide.routing` + `en`; do not guess from a title                                      |
| `role`                                 | `specification`, `guide`, `reference`, `example`, `troubleshooting`, or `resource`                               |
| `route` / `canonicalUrl`               | Route and authoritative public URL for this build                                                                |
| `sourcePath` / `contentHash`           | Source path and SHA-256 of the raw document content, identifying the version read                                |
| `title` / `summary`                    | Retrieval display data; a summary is not a complete operating requirement                                        |
| `relatedDocuments`                     | Array of `{ docId, locale, canonicalUrl }`, the union of internal incoming and outgoing document links           |
| `audience` / `appliesTo` / `stability` | Metadata currently inferred from path/version channel; does not prove a feature was tested or a project complies |

By default, a docId comes from the relative `.md`/`.mdx` path after removing the locale, for example `api/config.md` → `api.config`. A nested index retains its identity; the home page is `index`. When moving a page, Frontmatter `docId` can retain its identity, but an old ID must not be reused for unrelated content. Roles default by directory; home and Benchmark are resources. The frontend boundary page explicitly has the specification role, and a troubleshooting page can override its directory default.

Both locale records for the same logical page share docId and role; consumers still select the desired locale record. Relative links inherit the source document location. An absolute `/guide/...` points to English; Chinese should use `/zh/guide/...`. `relatedDocuments` is a union of document relationships, not a directed dependency model. Do not derive capability relations such as `requires`, `conflicts`, or `implements` from it.

## Rule References

[Development Specifications](/specification/) use stable Rule IDs. Conceptually one may call this a `ruleId`, but each record in `spec-rules.json.rules` actually uses the field **`id`**. Its unique key is `(id, locale)`. Records contain `level`, `title`, `docId`, `canonicalUrl`, `anchor`, `ruleUrl`, and `contentHash`.

- A source heading is `### VEXT-HTTP-001 [MUST] Title`, preceded by an explicit lowercase ID anchor. Supported prefixes are ARCH, HTTP, CONTRACT, DATA, SEC, RESOURCE, JOB, and OPS.
- Levels serialize as `must`, `must-not`, `should`, and `may`. Read the full applicability condition before interpreting the level; not every MUST has an automatic static checker.
- The rule hash includes its heading and body, including code, rather than the whole page. Those hashes serve different purposes.
- Preserve a Rule ID when moving a rule; update references when splitting or removing one. Do not silently resolve an obsolete ID to a similar heading.

For example, to inspect the validation/business boundary in English, select `docId=specification.validation-and-contracts` in the `en` locale and find `id=VEXT-CONTRACT-001` in rules from the same snapshot. Confirm the docId matches, then use `ruleUrl`. Read the [Validation and Data Contracts rule](/specification/validation-and-contracts#vext-contract-001) in context.

## One Snapshot and Rollout Stage

The manifest and rules share top-level `documentationRevision`, `rollout`, `verification`, and `frameworkVersion`. `documentationRevision` is a SHA-256 over source paths/content hashes and relevant build-contract inputs. A framework version cannot substitute for a documentation revision. Never join the two artifacts when their revisions differ, even if a docId coincides. `frameworkVersion` comes from this source tree's package manifest; neither it nor the site channel proves that a published package contains every behavior described by a work-in-progress documentation snapshot. Match an installed release to its release notes or source identity before using these pages as version-specific evidence.

| Item                       | Integration requirement                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `rollout=zh-routing-pilot` | Chinese routing pilot, for local/development review only                              |
| `rollout=zh-complete`      | Complete Chinese stage; English may remain untranslated, so no bilingual mirror claim |
| `rollout=final`            | Bilingual closure stage; still check full verification results                        |
| `verification.scope=page`  | Page check with `sourcePath`, not whole-site acceptance                               |
| `verification.scope=stage` | Whole-stage check; formal publishing requires `final` + `stage` and the release gate  |

Neither Chinese stage nor any page-scoped artifact is publishable. Graph consumers may explicitly use a Chinese-stage snapshot during development but must retain that limitation. The presence of an English manifest entry does not mean that English content passed the current review.

Recommended lookup sequence: validate schema and stage/scope → confirm both revisions match → select the unique `(docId, locale)` → when citing a rule, validate `(id, locale)` and docId → read that version of the page and rule URL. Missing pages, wrong locale, stale rules, or mixed snapshots should fail explicitly; do not switch language or guess a similar page silently.

## How a Future Knowledge Graph Integrates

| Information                                            | Responsible source                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Explanations, procedures, examples, known limitations  | `website/docs` page content                                                     |
| Stable document references                             | Manifest v2 `docId`/`locale` and URLs                                           |
| Framework rule identities                              | Specification Rule IDs / `spec-rules.json`                                      |
| Capability definitions, relations, machine `whenToUse` | Future Capability Definition, not implemented yet                               |
| What a project actually uses                           | Evidence from a future/relevant Project Inspector, not inferred from site prose |
| Whether project code complies                          | Compliance / Diagnostics, not proven by document links                          |

Documentation-side readiness requires resolvable identity, an answer supported by the page, explicit defaults and failure boundaries, valid rule/links, and artifacts from one snapshot. It is not certification that all runtime defects are fixed or that a project already has a capability. For example, configuration that is declared but not connected, external plugin peer compatibility conditions, and historical Benchmark data must be cited with their limitations.

Do not add capability IDs or a second machine `whenToUse` to Markdown, expand the existing `capabilities.json` into a graph, or copy/migrate Knowledge for integration. Future consumers should reference this site's prose and stable identifiers while owning their own capability contract.

## How an AI answer should use the docs

1. Validate schema, stage, and snapshot as described above. Select the exact locale entry in `docs-manifest.json`, read its full content, and cite its canonical URL.
2. Treat `capabilities.json` as a retrieval summary. Before claiming a capability is usable, read its detailed conditions and limitations; a `supported` tag alone is insufficient.
3. For RSC, Server Functions, Server Actions, PPR, and bundler assumptions,
   read [Frontend Boundaries and Roadmap](/frontend/boundaries-and-roadmap)
   rather than inferring support from React, SSR, Suspense, or Streaming SSR.
4. Use `ai-gold-questions.json` for answer regression. `requiredDocIds` for a Chinese question must resolve within that locale, with routes equal to `requiredRoutes`; the final bilingual stage also checks mirror equivalence. After structural checks, AI Review must judge whether the actual page answers the question and respects `mustNotClaim`, not merely count links.

Maintainers can run the existing `npm run verify:docs-contract`, site build, and `verify:docs-rendered` with the same explicit rollout; omit `--page` for stage closure. Existing tests include negative cases for missing documents, wrong locale, stale rules, mixed snapshots, and missing/extra relationship links. A successful build cannot replace content Review, and no separate per-page script is needed to simulate semantic review.

## Measurement is optional and privacy-first

VextJS does not ship a tracker, analytics SDK, collector endpoint, cookie, or
identity graph for this documentation site. The event schema intentionally
allows only page, locale, event kind, referrer class, optional search length,
and CTA class, rejecting extra fields. Collection policy excludes raw search text, URL query values, credentials, page content, and user identity. The schema does not automatically sanitize strings: a future collector must normalize `page` to a path without query and enforce these policies.

A documentation site owner may wire a collector later only after choosing the
provider, legal basis, retention, consent behavior, and security review. The
JSON files define what an implementation may measure; they are not permission
to collect data and do not by themselves measure revenue or conversion.

To report a documentation gap, open a
[GitHub Discussion](https://github.com/devcodex-labs/vextjs/discussions).
