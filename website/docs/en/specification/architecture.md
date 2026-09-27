# Architecture and Responsibility Specifications

This page defines the responsibilities and actual loading boundaries of a VextJS application's parts. It applies to the current framework's development, production, and test entry points. Directory organization guidance uses `SHOULD`; loading contracts use `MUST`. Guidance does not mean the runtime automatically checks all business code.

If you are creating a project for the first time, read [Project Structure](/guide/project-structure). Rules for HTTP registration, request handling, and route options are in [HTTP and Routing Specifications](/specification/http-and-routing).

## Responsibilities by part

| Part                         | Responsibility                                                                                             | Invocation or loading                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Route                        | Declare the HTTP method, path, validation, and response contract; coordinate request handling in a handler | `defineRoutes()` registers synchronously; the handler runs on request                                        |
| Service                      | Reusable business use cases, data access composition, and business decisions                               | The loader instantiates default-exported constructors and attaches them to `app.services`                    |
| Model / data access          | Persistence, indexes, transactions, and other data consistency responsibilities                            | Use `app.db` after configuring the database; database integration loads Models                               |
| Schema                       | Describe the shape and format of input/output data                                                         | Ordinary import; `validate` consumes input schemas and the `responses` contract consumes JSON output schemas |
| Business validation function | Business decisions such as payment eligibility and state transitions                                       | Business code calls it explicitly; there is no separately injected Domain Validator system                   |
| Middleware                   | Cross-cutting request lifecycle handling                                                                   | A plugin registers global middleware, or a Route references declared middleware                              |
| Plugin                       | Initialize extensions and resources and manage their lifecycle                                             | `definePlugin()`; `setup()` runs in dependency order                                                         |
| Job                          | A non-HTTP task entry point and execution contract                                                         | `defineJob()`; loaded through the job CLI or job testing entry point                                         |
| Frontend                     | Pages, layouts, interactions, and browser assets                                                           | Frontend build and renderer; Route plus `res.render()` owns the page URL                                     |
| Config                       | Startup options, resources, and environment-specific settings                                              | Startup configuration merging, provider evaluation, and final configuration validation                       |

## Automatic loading and directory settings

<a id="vext-arch-001"></a>

### VEXT-ARCH-001 [MUST] Automatic entry points must follow their actual loader contracts

The ordinary CLI startup loads configuration and backend entry points from the project's `src` directory or its resolved build output. The paths below are default application source locations; corresponding build artifacts provide runtime entry points after a build.

| Source role          | Default source path | Current public path setting                                                            |
| -------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| Configuration        | `src/config`        | A profile selects a configuration file; it does not rename the configuration directory |
| Routes               | `src/routes`        | There is no `config.routesDir`                                                         |
| Services             | `src/services`      | There is no `config.servicesDir`                                                       |
| User plugins         | `src/plugins`       | There is no `config.pluginsDir`                                                        |
| Route middleware     | `src/middlewares`   | There is no `config.middlewaresDir`; `config.middlewares` is a declaration list        |
| Data models          | `src/models`        | `config.database.models.dir`, conditional on database enablement                       |
| Jobs                 | `src/jobs`          | `config.jobs.dir`                                                                      |
| Backend locale files | `src/locales`       | `config.locale.directory`                                                              |
| Frontend             | `src/frontend`      | `config.frontend.root`, `pages.dir`, and other frontend path options                   |

Business implementations may live in project-specific directories when supported entry points explicitly import and delegate to them. Changing a directory description in tooling or creating a similarly named folder does not change the runtime loader. Check extensions, exclusion rules, export forms, and path resolution in the respective guides; do not infer that every role uses one scanning rule.

Related guides: [Project Structure](/guide/project-structure), [Configuration](/guide/configuration), [Frontend Configuration](/frontend/configuration), and [Jobs](/guide/jobs).

<a id="vext-arch-002"></a>

### VEXT-ARCH-002 [SHOULD] Organize ordinary modules around consumers and import them explicitly

`schemas`, `validators`, `modules`, `utils`, `constants`, and application-owned `types` are organization choices. They do not automatically create `app.schemas`, `app.validators`, or module registration.

Helpers and types for one use case can live near that use case. Extract shared modules when there are real shared consumers. Do not create empty layers solely to satisfy a directory tree. A scanned service directory should contain service entry points; shared constants and pure types are better kept outside that scanned directory.

## Business composition and initialization timing

<a id="vext-arch-003"></a>

### VEXT-ARCH-003 [SHOULD] Routes handle transport contracts; services organize reusable business logic

A Route obtains request data, chooses an HTTP response, and declares the interface contract. Business use cases shared by multiple entry points are better placed in a Service or an explicitly imported business function. HTTP handlers and Jobs may call the same use case; do not simulate an HTTP request just to reuse internal business logic.

The framework does not forbid a handler from accessing the database directly or require a Repository layer. Whether to extract a data access module depends on actual reuse, transaction boundaries, and maintenance needs. Make the respective responsibilities of Models, services, and caches explicit.

A passing input Schema does not prove that the user is authorized, the business state permits the action, or a database uniqueness condition holds. `VextValidator` is a Schema compilation/validation interface; its name does not imply an automatically executed business validation system. See [Validation](/guide/validation) and [Database](/guide/database).

<a id="vext-arch-004"></a>

### VEXT-ARCH-004 [MUST] Initialization code must respect when resources and services become available

Ordinary HTTP startup resolves configuration, creates the application and Adapter, loads locales and the conditionally enabled built-in database plugin, then initializes user plugins, route middleware, services, and routes. Ready callbacks run after HTTP begins listening. Development entry points include build and reload steps; this dependency order does not mean every entry point has identical internal steps.

- When a user plugin's `setup()` runs, business services have not yet been injected. It must not assume instances are already available in `app.services`.
- When a Service constructor runs, other Services may not yet have been instantiated. Prefer saving `app` in the constructor and accessing dependencies in business methods rather than treating file traversal order as an initialization contract.
- Delayed access resolves initialization timing; it does not automatically eliminate cycles between services. The framework detects dependency cycles it can determine statically. Analysis of dynamic access may be incomplete, so an unreported cycle is not proof that dependencies are correct.
- A Route factory registers synchronously. Put asynchronous work in a handler or an appropriate lifecycle stage; see the [HTTP factory rule](/specification/http-and-routing#vext-http-002).

Related references: [Services](/guide/services), [Plugins](/guide/plugins), and [Runtime Hooks](/guide/hooks).

<a id="vext-arch-005"></a>

### VEXT-ARCH-005 [SHOULD] Resource creators should manage and release their resources

Connections, subscriptions, and timers created by a plugin should be released through `onClose` or `app.onClose()`; the framework's database integration manages shutdown of its built-in database resource. Do not implicitly establish long-lived connections at the top level of ordinary shared Schema/type modules or in each request handler.

Expose extensions with `app.extend()` without occupying existing framework properties. For example, the built-in `app.cache` is a response cache interface; a custom cache client needs a distinct name. Verify startup failure, shutdown, and reload behavior against the resource's actual implementation, rather than checking only successful requests.

## HTTP, job, and frontend boundaries

<a id="vext-arch-006"></a>

### VEXT-ARCH-006 [MUST] Job execution and page rendering use their own explicit entry points

Creating a file in `src/jobs` does not cause ordinary HTTP startup to run or schedule it automatically. Choose and configure job execution, scheduling, queue workers, and storage as described in the [Jobs Guide](/guide/jobs). A Job handler's context is not an HTTP `req` / `res`.

Frontend page files are discovered and built by the renderer; they do not independently register backend URLs. A handler in `src/routes` calls `res.render()` to serve a page. Special SPA fallback behavior depends on explicit configuration. SSR, browser hydration, and API requests follow their respective lifecycles; see [Routing and Pages](/frontend/routing-and-pages) and [Rendering Modes](/frontend/rendering-modes).

<a id="vext-arch-007"></a>

### VEXT-ARCH-007 [SHOULD] Shared modules must respect browser and server dependency boundaries

Frontend and backend may share data types. Runtime Schemas or constants needed by the browser can also be shared explicitly, but must not pull in database instances, server configuration, or Node-only dependencies. A directory named `shared` does not remove those dependencies automatically.

A frontend API client consumes an interface contract; backend business modules are still invoked through backend entry points. Tools should generate build artifacts, declarations, and client contracts rather than turning them into a second manually maintained source of business logic. See [API Client and Contracts](/frontend/api-client-and-contracts) and [Diagnostics and Leak Scan](/frontend/diagnostics-and-leak-scan) for generation and diagnostic entry points.

## When checking a project

Confirm, in order, that the loader discovers each entry point; exports satisfy its contract; initialization does not read unavailable dependencies; requests and jobs use the correct business entry points; resources can be closed; and the frontend build does not cross the server boundary. If you find a problem, check actual configuration and errors, then the corresponding guide. A directory tree alone cannot prove that an application runs correctly.
