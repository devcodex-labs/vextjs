# Unreleased

## Changed

- Replaced the default `app.logger` runtime with Vext's internal zero-runtime-dependency logger kernel while preserving the public `VextLogger` contract, numeric JSON levels, child loggers, pretty/JSON modes, requestId/trace field injection and `app.setLogger()` wrapper extension path.
- Removed direct runtime dependencies on external logger packages from `package.json`, `package-lock.json` and the CJS external dependency list. Fastify may still bring its own transitive logger dependency through the optional Fastify adapter host dependency tree.
- Updated logger, access-log, configuration and OpenTelemetry website docs to describe stdout-first collection, external log agents, true `accessLog` options and `app.setLogger()` bridge plugins instead of application-level logger transports.
- Documented the intentionally unsupported Pino feature surface after the built-in logger migration, including transports, redaction, serializers, custom levels, runtime level mutation, full pino-pretty options and browser API.

## Fixed

- Ensured Error-first logger calls are serialized consistently and reflected in the public TypeScript overloads.
- Preserved repeated non-circular nested references during logger serialization while still marking real circular references as `[Circular]`.
- Added default logger lifecycle cleanup during app shutdown so custom sinks can flush/close before process exit.
- Kept `response-cache-kit` external in generated CJS bundles and added an audit probe to prevent runtime dependencies from being inlined into package entry bundles.

## Verification

- `npm run format:check`
- `npm run typecheck`
- Targeted logger/package tests
- `npm run build`
- `npm test`
- `npm run test:audit`
- `npm --prefix website run build`
- `npm pack --dry-run --json`
- `npm --prefix E:\Worker\vext-test run verify:all`
