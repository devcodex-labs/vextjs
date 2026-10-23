# Unreleased

The next release is in development. Shared foundation repairs include:

- Route factory validation respects lexical shadowing; static route metadata becomes unknown when an executing factory lets its options escape to mutable code.
- Runtime service loading and Doctor share an injection-aware dependency graph. Unrelated names and comments no longer create cycles; unsupported dynamic origins remain incomplete.
- The public dictionary loader is `loadI18n(app, directory, options?)`. Each application owns its dictionary; failed loads preserve it, missing directories clear it, and `createTestApp` loads locales before user initialization.
- Compiled preloads resolve inside the selected output directory, including explicit output outside the service root.
- External compiled output retains each service's dependency scope for CommonJS, native dynamic imports, and ESM preloads. Runtime helpers share the backend artifact transaction; deployment preserves the relative service/output layout.
- Filesystem deployment coordinates physical directory overlaps and shares state across equivalent directory/prefix representations.
- Private frontend writers without production consumers are removed; candidate generation and artifact transactions remain the shared write path.
- Scheduled Jobs use explicit Cron and one default SDK Job per selected file. Automatic Local, built-in Master IPC and Redis coordination share startup activation and shutdown rules; per-job Redis leaseTtl, finite declaration validation, Docs/MCP metadata and bilingual examples follow the same contract.
- Scheduled Jobs reject delayed activation after a trusted stop, including a stop received before activation. Manifest conflicts identify changed task and coordination fields. MCP diagnoses known invalid fields independently of an opaque Cron; documentation distinguishes Worker activation from Master's overall ACK barrier.
- Scheduled Jobs are enabled by default and scan `src/jobs`; `createTestJobScheduler` drives deterministic Job tests. Upgrade notes are in `MIGRATION.md` (2.0 → 2.1).
- Dependencies: `monsqlize@3.3.3` (adds the allowed `cursorValueNormalizerVersion` option; cache keys rebuild and Change Stream checkpoints use v2), `schema-dsl@3.0.5` (fast-path `type` + `enum` checks), `route-core@0.0.8` (metadata only), and `@modelcontextprotocol/server@2.3.1` (clears three high advisories). The remaining `braces`/`micromatch`/`fast-glob` advisory has no upstream fix.
- MCP project checks now report bounded static diagnostics for route response schemas, deprecated docs tags, service dependency analysis, Redis targets, cursor-secret choices, upload/form boundaries, placeholder tests, and generated-code quality.
- README, bilingual guides, and public comments describe the exact Node engine range, owned-output cleanup, configuration layers, and current analysis boundaries.

These changes are not a published release. Broader MCP roadmap work remains tracked separately; the Jobs behavior above describes the current source candidate.

The stable `2.0.0` major release was published on 2026-09-08. Its user-visible
changes, migration checklist, release qualification, and compatibility notes
are recorded in `changelogs/v2.0.0.md` and summarized in the root
`CHANGELOG.md`.

The published `1.0.2` runtime-contract, documentation, benchmark, and dependency
work remains recorded in `changelogs/v1.0.2.md`; the original schema-dsl v3 and
MonSQLize migration remains recorded in `changelogs/v1.0.0.md`.
