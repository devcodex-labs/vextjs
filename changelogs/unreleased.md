# Unreleased

The current source line contains backward-compatible work intended for the next
unpublished patch release:

- English-first generated user source across TypeScript/JavaScript and full-stack/API-only starter modes.
- Inline route-validation inference for `req.valid(location)` with `schema-dsl@3.0.4`.
- Registration-time compiled JSON response schemas shared by all five adapters, OpenAPI, route manifests, and generated client types.
- `monsqlize@3.3.0`, controlled advanced constructor options, typed Model descriptors through the raw upstream instance, and complete model/collection capability access while preserving the stable `app.db` facade and a single deduplicated `schema-dsl@3.0.4` installation.

The original schema-dsl v3 / MonSQLize migration and frontend runtime remain recorded in `changelogs/v1.0.0.md`; the already published v1.0.1 documentation and release-validation changes remain recorded in `changelogs/v1.0.1.md`.
