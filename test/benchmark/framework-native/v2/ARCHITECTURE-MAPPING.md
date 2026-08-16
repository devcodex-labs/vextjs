# Framework-native v2 architecture mapping

This mapping fixes the implementation boundary for the Windows x64 Enterprise
API benchmark. It compares equivalent observable capabilities, not identical
internal abstractions. Each target owns its documented production path.

| Capability                      | VextJS + Native Adapter                                                              | Direct Fastify                                                | NestJS + Fastify                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| HTTP host / route               | Vext formal `bootstrap()` with the Native adapter and a `defineRoutes()` route.      | `Fastify()` route plus plugin encapsulation/decorations.      | `NestFactory.create()` with `FastifyAdapter` and a controller.               |
| Correlation / context           | Vext request ID and public request-context store.                                    | Fastify request ID plus `@fastify/request-context`.           | Fastify request ID plus Nest ALS middleware.                                 |
| Auth / authorization            | Vext public `auth()` middleware, `jose` verification, route permission.              | `@fastify/jwt` verification in `preValidation`.               | `@nestjs/jwt` verification in `CanActivate` guard.                           |
| Strict JSON validation          | Vext public plugin-level `app.setValidator()` wrapping the ordinary route validator. | Fastify JSON Schema with Ajv coercion/removal disabled.       | `ValidationPipe`, DTO decorators, `class-validator` and `class-transformer`. |
| Service / repository            | Vext service loader invokes the shared `OrderService` and bounded repository.        | Plugin decoration invokes the same shared service/repository. | Provider injection invokes the same shared service/repository.               |
| Security headers                | Vext `securityHeaders: basic`.                                                       | `@fastify/helmet`.                                            | `@fastify/helmet` on the Fastify host.                                       |
| Errors / completed access event | Vext default error lifecycle plus public `app.hooks` error-completion access event.  | Fastify error handler plus `onResponse` access event.         | Nest exception filter plus Fastify `onResponse` access event.                |

The shared `OrderService`, bounded repository, controlled HTTP quote client,
request contract, and semantic hash prove comparable business behavior. The
measurement fixture has no observer, counters, control route, or application
resource sampler. Test-only observation exists only in a physically separate
conformance fixture.

## Documentation evidence

- [Fastify Plugins Guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/)
  documents plugins, encapsulation, and decorations used by the direct Fastify
  target.
- [NestJS Fastify adapter](https://docs.nestjs.com/techniques/performance),
  [AsyncLocalStorage](https://docs.nestjs.com/recipes/async-local-storage), and
  [Validation](https://docs.nestjs.com/techniques/validation) document the Nest
  host, context, and validation paths.
- [Autocannon API](https://github.com/mcollina/autocannon#api) documents the
  load process's `requests[].setupRequest` factory. The factory is deliberately
  confined to the load role and headroom-calibrated.

Vext uses public framework APIs only. The benchmark never modifies Vext runtime
source, adapters, middleware implementation, logger implementation, or default
framework semantics.
