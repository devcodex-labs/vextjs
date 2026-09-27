# Build and Operations Specifications

This page defines the boundary from local application verification to production operation. See [CLI](/guide/cli), [Build](/guide/build), and [Deployment](/guide/deployment) for commands, and [Frontend Build and Deploy](/frontend/build-and-deploy) for frontend delivery.

## Checks, tests, and builds

<a id="vext-ops-001"></a>

### VEXT-OPS-001 [SHOULD] Verify types, behavior, and deployable artifacts separately

Type checks, tests, builds, and actual startup prove different things. TypeScript compilation does not prove endpoint behavior is correct; a passing build does not prove that the database, external services, proxy configuration, or production permissions are available.

For a TypeScript application, `vext build` refreshes generated declarations and the route manifest before compiling the backend. `--typecheck` explicitly enables local project TypeScript checking. The default build does not run that check; do not record an ordinary successful build as a passing typecheck.

Project tests should cover real behavior such as invalid inputs, denied access, dependency failures, and resource cleanup. In-memory requests from `vextjs/testing` are useful for fast feedback. Also verify real HTTP, the chosen Adapter, and enabled frontend browser behavior for the delivery environment; see [Testing](/guide/testing).

## Production mode and configuration

<a id="vext-ops-002"></a>

### VEXT-OPS-002 [MUST] Distinguish runtime mode, configuration profile, and build-time replacement

`vext start` uses production runtime mode. For configuration profiles, `--config` takes precedence over `VEXT_CONFIG`, followed by the command default. The legacy, nonstandard `NODE_ENV` profile behavior remains only as a compatibility path with a warning.

The backend production compilation of `vext build` statically replaces `process.env.NODE_ENV` in user source. Switching runtime profiles does not restore environment branches removed from build output. Supply settings that must change at runtime through real configuration entry points; changing an environment variable cannot rewrite compiled output.

See [Configuration](/guide/configuration) for merging, providers, and when local files apply. Do not assume a local override present in development will load in production.

<a id="vext-ops-003"></a>

### VEXT-OPS-003 [MUST] Start from valid, matching build output

Production startup of a TypeScript backend requires valid build artifacts. When they are absent or invalid, build again; `vext start` does not fall back to executing TypeScript source. JavaScript source mode depends on actual backend source and build identity; the mere presence of `tsconfig.json` does not make it compiled mode.

Build output selection uses an explicit `--outdir` / `VEXT_BUILD_OUTDIR`, a successful build record, and the default `dist`, in that order. Build locations, buildId, and other metadata participate in startup verification. Copying a few `.js` files or editing metadata manually does not create a complete successful build.

`--clean` removes old output according to recorded artifact ownership. Do not place uploads, exports, or other persistent user data in a build-managed output directory. A custom output directory must not overlap source, tests, dependencies, Git, or `.vext` metadata.

## Frontend and deployment artifacts

<a id="vext-ops-004"></a>

### VEXT-OPS-004 [MUST] Deliver complete runtime artifacts for enabled features

When frontend support is enabled, browser assets, the SSR renderer, relevant manifests, and the backend build must match. Production startup checks frontend artifacts; a successful browser-asset upload does not prove the complete application can start.

Public frontend assets and the server-side renderer have different delivery purposes. Configure CDN upload, publicPath, integrity checks, and cache updates under the frontend deployment contract; do not upload every build file as a public static resource.

Verification should check real pages, asset requests, SSR/hydration, API requests, and error pages. A homepage HTTP 200 alone does not prove dynamic pages or later navigation work. External dependencies must still resolve in the deployment environment; per-file backend compilation does not mean all npm dependencies were bundled into one file.

## Multiple processes and shutdown

<a id="vext-ops-005"></a>

### VEXT-OPS-005 [SHOULD] Design multi-worker deployment around state ownership

Every Cluster worker owns its process-local state. Whether Sessions, rate limits, caches, and Job Stores are shared depends on their actual storage and namespaces. Enabling cluster does not convert in-memory state to shared state automatically.

Before scaling, check database connection pools, external request quotas, Job concurrency, and resource capacity. HTTP, scheduler, and Job workers use their own runtime entry points; adding HTTP workers does not start or manage Jobs. See [Cluster](/guide/cluster) and [Jobs Specifications](/specification/jobs).

<a id="vext-ops-006"></a>

### VEXT-OPS-006 [SHOULD] Verify readiness, health, and bounded shutdown

A listening port, completed ready callbacks, available critical dependencies, and business health are different states. Define an application health-check contract and verify the probe path used by the deployment platform; do not assume every project has a built-in health route.

HTTP shutdown stops accepting connections and waits for requests, calls close callbacks in reverse order, and releases framework resources within an overall deadline. Exceeding the deadline does not mean all cleanup finished. Make application close callbacks terminable and check the deployment platform's termination grace period.

Test helpers need their own `close` call; programmatically started Job runtimes must also close. Test mode and real processes handle signals differently. An in-memory test cannot establish that production SIGTERM behavior passes. See [Security and Resources](/specification/security-and-resources#vext-resource-001) for resource responsibility.

## Delivery verification record

Record actual code and configuration versions, dependency installation, commands and exit codes, test environment, artifact locations, and actual startup result for each delivery. Distinguish source checks, simulated tests, real dependency integration, and production-environment verification. Do not mark a project that was never run as passing.

Maintenance scripts in the framework repository belong to that repository. An application should call scripts defined by its own project or the public `vext` CLI. The Deployment Guide covers specific platforms, containers, and proxies; this page does not require every application to use one operations toolchain.
