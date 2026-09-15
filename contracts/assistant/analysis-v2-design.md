# Assistant analysis v2 contract target

This document records the repair contract. Project inspection, policy, source identity, static checks, and candidate validation now emit v2 analysis data. Recipe rendering, host adoption, runtime instances, generated schemas, documentation, and installed-package verification are tracked in the remaining repair batches; this document is not a completion certificate. The MCP transport and workspace/config schema versions are unchanged.

## Identity

`projectId` identifies a service root. `sourceRevision` binds normalized source records and declared shared inputs; `policyDigest`, `dependencyDigest`, and `implementationDigest` identify adopted policy, resolved dependencies, and the code loaded by the MCP process. `contextRevision` combines these inputs. Runtime timestamps and directory file counts cannot substitute for source content.

Every project-bound tool checks supplied `expectedIdentity`. Candidate validation binds its source view and policy; conflicting or missing required evidence cannot produce `applyReady: true`.

## Verdict and coverage

Business JSON explicitly uses `schemaVersion: 2`. Request status (`ok`/`error`), static verdict (`valid`/`invalid`/`incomplete`), and coverage (`complete`/`partial`/`metadata-only`/`unavailable`) are independent. Known errors yield invalid even when coverage is partial. Runtime and business validation remain unverified unless separately observed by the host.

Compute the complete requested-domain diagnostics, severity totals, and verdict before limiting the displayed page. Default domain equals `all`; unknown domains are errors. A cursor binds identity, domain/section, ordering, and offset. A stale cursor requests refresh.

## Candidate and source boundaries

Normalize logical and physical targets before duplicate/conflict checks. Parse TS/JS with the existing parser; validate other text according to its language. Existing files, traversal, undeclared linked roots, unsupported roles, and unreadable/partial inputs must not become valid by filtering or truncation. User roles override defaults while preserving actual loader/import and browser/server boundaries.

## Regression ownership

`test/unit/mcp/mcp-quality-regressions.test.ts` transfers the reproduced identity, filtering, syntax, path, role, configuration, and policy failures to source-based tests. Additional recipe consumers, runtime instances, installed knowledge, and real business behavior are verified by their owning repair batches. These tests assert desired behavior and must fail until repaired; no skipped tests or expected-failure annotations disguise the baseline.

The public surface remains seven Tools, eleven Resources, four Prompts, and seventeen Recipes. Documentation, generated schemas, templates, and CI consume the same implementation facts. Installing or running a new copy of the package is a host action, not a new MCP execution tool.
