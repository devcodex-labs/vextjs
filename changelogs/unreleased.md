# Unreleased

## Changed

- `vext start` now treats TypeScript projects as build-only: missing or incomplete `dist/` output fails fast with a `vext build` / `vext dev` hint instead of attempting a `tsx/esm` source fallback.
- `vext dev` keeps typegen as the blocking preflight step and runs TypeScript semantic diagnostics asynchronously by default. Use `--strict-preflight` or `VEXT_DEV_STRICT_PREFLIGHT=1` to restore blocking diagnostics.

## Fixed

- Reuses the typegen project index for service dependency analysis to avoid rebuilding the same `ts-morph` project index during one preflight/typegen pass.

## Verification
