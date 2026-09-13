# Unreleased

The next release is in development. Shared foundation repairs include:

- Route factory validation respects lexical shadowing; static route metadata becomes unknown when an executing factory lets its options escape to mutable code.
- Runtime service loading and Doctor share an injection-aware dependency graph. Unrelated names and comments no longer create cycles; unsupported dynamic origins remain incomplete.
- The public dictionary loader is `loadI18n(app, directory, options?)`. Each application owns its dictionary; failed loads preserve it, missing directories clear it, and `createTestApp` loads locales before user initialization.
- Compiled preloads resolve inside the selected output directory, including explicit output outside the service root.
- External compiled output retains each service's dependency scope for CommonJS, native dynamic imports, and ESM preloads. Runtime helpers share the backend artifact transaction; deployment preserves the relative service/output layout.
- Filesystem deployment coordinates physical directory overlaps and shares state across equivalent directory/prefix representations.
- Private frontend writers without production consumers are removed; candidate generation and artifact transactions remain the shared write path.
- Enterprise Jobs add a scheduler/worker runtime, per-job concurrency enforcement, scheduler lease renewal, stale file-store lock recovery, CLI operations, docs source metadata, and bilingual deployment documentation.
- README, bilingual guides, and public comments describe the exact Node engine range, owned-output cleanup, configuration layers, and current analysis boundaries.

These changes are not a published release. MCP implementation is still pending separate requirements and design acceptance.

The stable `2.0.0` major release was published on 2026-09-08. Its user-visible
changes, migration checklist, release qualification, and compatibility notes
are recorded in `changelogs/v2.0.0.md` and summarized in the root
`CHANGELOG.md`.

The published `1.0.2` runtime-contract, documentation, benchmark, and dependency
work remains recorded in `changelogs/v1.0.2.md`; the original schema-dsl v3 and
MonSQLize migration remains recorded in `changelogs/v1.0.0.md`.
