# Unreleased

## Changed

- `vext create` now defaults to a full-stack React template with `src/client`, `public`, frontend config, React dependencies, and API routes under `/api/*`; API-only scaffolding remains available through `--template api --frontend none`.
- Added `config.frontend`, `vextjs/frontend`, client contract generation, esbuild browser bundling, dev-time frontend rebuilds, and production static/SPAfallback serving from `dist/client`.
