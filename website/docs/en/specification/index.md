# Development Specifications

These specifications explain what VextJS applications must observe, how responsibilities are divided, and where current capabilities end. Read the Guide when completing a task for the first time; use the API Reference for exact parameters, defaults, and types. For failures, follow the relevant troubleshooting guide and verify the behavior.

## Read by topic

| Topic                                                                    | What it covers                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture and responsibilities](/specification/architecture)         | Automatic loading versus ordinary modules, directory settings, initialization timing, business logic, and frontend/backend boundaries |
| [HTTP and routing](/specification/http-and-routing)                      | Route registration, inputs and outputs, execution order, configuration overrides, and OpenAPI boundaries                              |
| [Validation and data contracts](/specification/validation-and-contracts) | The responsibilities of schemas, types, authorization, business invariants, and database constraints                                  |
| [Data access](/specification/data-access)                                | Raw `app.db`, Collection/Model, registration keys, transactions, multiple databases, and caching                                      |
| [Security and resources](/specification/security-and-resources)          | Identity, authorization, sessions/CSRF, security headers, rate limits, and resource cleanup                                           |
| [Jobs and scheduling](/specification/jobs)                               | Jobs, scheduler, worker, Store, leases, retries, and business idempotency                                                             |
| [Build and operations](/specification/operations)                        | Type/behavior/build verification, configuration profiles, production artifacts, processes, and shutdown                               |

For supported and unsupported frontend capabilities, see [Frontend Boundaries and Roadmap](/frontend/boundaries-and-roadmap). The presence of React, SSR, or Streaming does not imply that other frontend capabilities have been implemented.

## Interpret rule levels

| Level      | Meaning                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `MUST`     | A condition required by the stated framework contract                                                                             |
| `MUST NOT` | An action that conflicts with the stated contract or responsibility boundary                                                      |
| `SHOULD`   | Guidance that generally applies; a project may choose another approach for a clear reason after verifying the relevant boundaries |
| `MAY`      | An optional action, subject to the conditions given on the page                                                                   |

Check a rule's applicability before its level. For example, a database rule does not require every application to use a database; resource cleanup guidance does not mean the framework can automatically cancel every external side effect.

The runtime rejects some violations directly. Other responsibility boundaries must be maintained through project design and tests. Consult each rule's implementation notes; do not assume every `MUST` has an automatic static checker.

## Cite a rule

Rules have stable IDs, such as [VEXT-CONTRACT-001](/specification/validation-and-contracts#vext-contract-001). A citation should retain the documentation language, rule ID, and specific page URL. Do not quote a heading without its conditions.

Translations of the same rule share its Rule ID. When its text or implementation version changes, check the full current context again instead of applying an old snapshot to new code.

## Document responsibilities

| Document role   | Content it owns                                           |
| --------------- | --------------------------------------------------------- |
| Specification   | Responsibilities, contracts, constraints, and rule levels |
| Guide           | Prerequisites, steps, usage, and common problems          |
| Reference       | Exact types, fields, defaults, lifecycle, and errors      |
| Example         | Runnable combinations and verification steps              |
| Troubleshooting | Symptoms, evidence, causes, fixes, and rechecks           |
| Resource        | Entry points, indexes, and other reference material       |

Rule pages link to operational and reference pages instead of repeating entire tutorials. A topic may have pages with several roles; pages with the same role do not need an identical section template.

## Boundaries for tool references

The documentation manifest uses `docId` for logical identity and `(docId, locale)` for a specific language record. In `spec-rules.json`, the Rule ID field is `id`, and `(id, locale)` identifies a rule record; for example, `id: "VEXT-CONTRACT-001"`. Tools should use actual URLs from generated artifacts and the current documentation snapshot rather than guessing another language's URL from directory names.

These identifiers support references to documents and rules. They do not mean a Capability Graph or code compliance checker has already been implemented. See [Documentation Data and AI](/resources/documentation-data-and-ai) for more about machine-readable indexes.
