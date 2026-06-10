# Unreleased

## 2026-06-10

- **Dev startup observability**: added the default `vext dev` startup summary, aligned main/worker startup profiles with wall-clock offsets, exposed `gap.*` events, and recorded finer-grained dev bootstrap, plugin loader, and MonSQLize startup phases.
- **Port conflict handling**: made `--port-conflict next` skip unavailable Windows probe ports such as `EACCES`/`EINVAL` instead of failing before checking the next candidate.
