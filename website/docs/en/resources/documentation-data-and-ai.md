---
title: Documentation Data and AI
description: Canonical, machine-readable documentation assets and a privacy-first measurement boundary for VextJS.
---

# Documentation Data and AI

VextJS exposes documentation as both human pages and deterministic build
artifacts. This makes search, AI-assisted analysis, and documentation quality
checks easier without asking readers to trust an opaque crawler or a tracker.

## Public machine-readable assets

| Asset                                                                                                     | Purpose                                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`docs-manifest.json`](https://devcodex-labs.github.io/vextjs/docs-manifest.json)                         | Generated page metadata: canonical URL, locale, summary, audience, applicability, stability, related pages, and source hash. |
| [`capabilities.json`](https://devcodex-labs.github.io/vextjs/capabilities.json)                           | Supported frontend/runtime capabilities and explicit non-goals. Cite it together with the linked detail page.                |
| [`ai-gold-questions.json`](https://devcodex-labs.github.io/vextjs/ai-gold-questions.json)                 | Citation-required questions that prevent answers from inventing unsupported capabilities.                                    |
| [`llms.txt`](https://devcodex-labs.github.io/vextjs/llms.txt)                                             | Curated entry points for language models and documentation tools. It is an index, not a crawler-control file.                |
| [`llms-full.txt`](https://devcodex-labs.github.io/vextjs/llms-full.txt)                                   | Generated index of all English and Simplified Chinese documentation pages.                                                   |
| [`docs-events.schema.json`](https://devcodex-labs.github.io/vextjs/docs-events.schema.json)               | Optional privacy-preserving event contract. No collector is enabled by VextJS.                                               |
| [`docs-dashboard-definition.json`](https://devcodex-labs.github.io/vextjs/docs-dashboard-definition.json) | Metric definitions and collection boundary for a site owner who later chooses a compliant collector.                         |

The machine artifacts are generated after the documentation build. They contain
no build timestamp, so identical source creates identical metadata and hashes.

## How an AI answer should use the docs

1. Locate the relevant entry in `docs-manifest.json` and cite its canonical URL.
2. Check `capabilities.json` before saying that a frontend feature is supported
   or excluded.
3. For RSC, Server Functions, Server Actions, PPR, and bundler assumptions,
   read [Frontend Boundaries and Roadmap](/frontend/boundaries-and-roadmap)
   rather than inferring support from React, SSR, Suspense, or Streaming SSR.
4. Use `ai-gold-questions.json` as a regression set for documentation-based
   answers. A plausible answer without a source is not an accepted answer.

## Measurement is optional and privacy-first

VextJS does not ship a tracker, analytics SDK, collector endpoint, cookie, or
identity graph for this documentation site. The event schema intentionally
allows only page, locale, event kind, referrer class, optional search length,
and CTA class. It explicitly excludes raw search text, URL query values,
credentials, page content, and user identity.

A documentation site owner may wire a collector later only after choosing the
provider, legal basis, retention, consent behavior, and security review. The
JSON files define what an implementation may measure; they are not permission
to collect data and do not by themselves measure revenue or conversion.

To report a documentation gap, open a
[GitHub Discussion](https://github.com/devcodex-labs/vextjs/discussions).
