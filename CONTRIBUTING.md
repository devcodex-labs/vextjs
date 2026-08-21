# Contributing to vext

Thank you for your interest in contributing to vext! We welcome contributions of all kinds — bug fixes, new features, documentation improvements, and more.

## 📋 Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Contribution Workflow](#contribution-workflow)
- [Code Style](#code-style)
- [Testing](#testing)
- [Commit Convention](#commit-convention)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Reporting Issues](#reporting-issues)

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js** >= 20.19.0
- **npm** >= 9.0.0
- **Git**

### 1. Fork and Clone

```bash
git clone https://github.com/YOUR_USERNAME/vextjs.git
cd vextjs
```

### 2. Install Dependencies

```bash
npm ci  # Use ci for reproducible installs
```

### 3. Verify Setup

```bash
# Type check
npx tsc --noEmit

# Run all tests
npm test

# Run specific test suites
npm run test:unit        # Unit tests only
npm run test:int         # Integration tests only
npm run test:e2e         # E2E tests only
npm run test:cov         # With coverage report
```

---

## 📂 Project Structure

```
vext/
├── src/
│   ├── adapters/          # Adapter implementations (hono, fastify, express, koa, native)
│   ├── cli/               # CLI commands (start, dev, build, create, stop, reload, status)
│   │   └── utils/         # CLI utilities (project detection)
│   ├── lib/               # Core framework modules
│   │   ├── build/         # Build compiler (esbuild)
│   │   ├── cluster/       # Cluster multi-process management
│   │   ├── dev/           # Dev server (hot reload, file watcher)
│   │   ├── middlewares/   # Built-in middlewares
│   │   ├── openapi/       # OpenAPI / Swagger generation
│   │   └── plugins/       # Built-in plugins (monsqlize)
│   ├── testing/           # Test utilities (createTestApp)
│   └── types/             # TypeScript type definitions
├── test/
│   ├── unit/              # Unit tests (mirrors src/ structure)
│   ├── integration/       # Integration tests
│   ├── e2e/               # End-to-end tests
│   └── benchmark/         # Performance benchmarks
├── .github/
│   ├── workflows/         # CI/CD pipelines
│   └── ISSUE_TEMPLATE/    # Issue templates
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

### Key Architectural Concepts

- **Adapters**: vext supports 5 HTTP adapters (Hono, Fastify, Express, Koa, Native). All adapters implement the `VextAdapter` interface and must pass the same test suite.
- **Middleware Chain**: Uses an onion model (`executeChain` with `dispatch(i)` recursion). Global middlewares are prepended to route-level chains.
- **Service Loader**: Auto-scans `src/services/` and injects instances into `app.services`.
- **Config Loader**: Merges `default` → `{NODE_ENV}` → `local` config files with environment variable overrides.

---

## 🔄 Contribution Workflow

> **Maintainer workflow:** this project is currently maintained by its owner on
> `main`. For an explicitly authorized maintenance task, the owner runs the
> required local gates and pushes directly to `main`; no intermediate repository
> branch or PR is required. External contributors should continue to use the
> branch-and-PR workflow below.

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 2. Make Changes

- Follow existing code patterns and conventions
- Add JSDoc comments for all public APIs
- Keep functions focused and small

### 3. Write Tests

- Every new feature or bug fix must include tests
- Match the test file structure to the source file structure
- Use descriptive test names

### 4. Run Checks

```bash
# Type check (must pass with zero errors)
npx tsc --noEmit

# Run all tests
npm test

# Run only your tests during development
npx vitest run test/unit/your-test-file.test.ts
```

### 5. Submit a Pull Request

Push your branch and open a PR against `main`.

---

## 📐 Code Style

### TypeScript

- **Strict mode** enabled — no `any` unless absolutely necessary (with `eslint-disable` comment)
- **ESM** — use `import`/`export`, file extensions in imports (`.js` suffix for TypeScript)
- **Explicit types** for function parameters and return types on public APIs
- **Readonly** where applicable

### Naming Conventions

| Type                  | Convention       | Example                             |
| --------------------- | ---------------- | ----------------------------------- |
| Variables / Functions | camelCase        | `createApp`, `loadConfig`           |
| Classes               | PascalCase       | `ClusterMaster`, `HttpError`        |
| Constants             | UPPER_SNAKE_CASE | `DEFAULT_CONFIG`, `EMPTY_MIXIN`     |
| Interfaces / Types    | PascalCase       | `VextAdapter`, `VextRequest`        |
| Files                 | kebab-case       | `config-loader.ts`, `rate-limit.ts` |

### Comments

- All public APIs must have JSDoc with `@param`, `@returns`, and `@example` where helpful
- Use `// ── Section Name ──` comment separators for file organization
- Keep comments meaningful — explain _why_, not _what_

### File Organization

```typescript
// 1. Imports (grouped: node built-ins → third-party → project internal)
import fs from "node:fs";
import path from "node:path";

import type { VextApp } from "../types/app.js";

// 2. Type definitions
interface MyOptions {
  /* ... */
}

// 3. Constants
const DEFAULT_VALUE = 42;

// 4. Main exports (classes, functions)
export function myFunction(): void {
  /* ... */
}

// 5. Helper functions (private)
function helperFunction(): void {
  /* ... */
}
```

---

## 🧪 Testing

### Test Framework

- **Vitest** for all tests
- **No external test databases or services** — use mocks for I/O

### Test Structure

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ModuleName", () => {
  describe("functionName", () => {
    it("should do X when Y", () => {
      // Arrange
      // Act
      // Assert
    });

    it("should throw when invalid input", () => {
      expect(() => fn(null)).toThrow("[vextjs]");
    });
  });
});
```

### Test Categories

| Type        | Location            | Command              | Purpose                                            |
| ----------- | ------------------- | -------------------- | -------------------------------------------------- |
| Unit        | `test/unit/`        | `npm run test:unit`  | Test individual functions/classes in isolation     |
| Integration | `test/integration/` | `npm run test:int`   | Test module interactions (cluster IPC, etc.)       |
| E2E         | `test/e2e/`         | `npm run test:e2e`   | Test full HTTP request/response with real adapters |
| Benchmark   | `test/benchmark/`   | `npm run test:bench` | Performance measurements (not part of CI)          |

### Coverage

- Aim for **80%+** coverage on new code
- Critical paths (adapters, middleware chain, config loader) should be **90%+**
- Run `npm run test:cov` to generate coverage reports

### Testing Adapters

If your change affects adapter behavior, test across all 5 adapters:

```typescript
const adapters = ["hono", "fastify", "express", "koa", "native"];

for (const adapter of adapters) {
  describe(`${adapter} adapter`, () => {
    it("should handle the scenario", async () => {
      // Test with this adapter
    });
  });
}
```

---

## 📝 Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type       | Description                                             |
| ---------- | ------------------------------------------------------- |
| `feat`     | New feature                                             |
| `fix`      | Bug fix                                                 |
| `docs`     | Documentation only                                      |
| `test`     | Adding or updating tests                                |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement                                 |
| `ci`       | CI/CD changes                                           |
| `chore`    | Maintenance tasks                                       |

### Scopes (optional)

`adapter`, `cli`, `middleware`, `config`, `cluster`, `openapi`, `plugin`, `types`, `benchmark`, `dev`

### Examples

```bash
git commit -m "feat(adapter): add WebSocket support to native adapter"
git commit -m "fix(cli): handle spaces in project path for vext create"
git commit -m "test(middleware): add rate-limit edge case tests"
git commit -m "perf(adapter): reduce closure allocations in executeChain"
git commit -m "docs: update README with benchmark results"
```

---

## 🔀 Pull Request Guidelines

### Before Submitting

- [ ] TypeScript compiles with zero errors (`npx tsc --noEmit`)
- [ ] All tests pass (`npm test`)
- [ ] New code has test coverage
- [ ] JSDoc comments added for public APIs
- [ ] No unnecessary `console.log` statements left in code
- [ ] Commit messages follow conventional commits

### PR Description

Use the [PR template](/.github/pull_request_template.md) — it includes:

- Description of changes
- Type of change (bug fix, feature, breaking change, etc.)
- Adapter impact assessment
- Test results
- Checklist

### Review Process

1. **Automated checks**: CI runs type checking, linting, and full test suite (Node 20/22)
2. **Code review**: At least one maintainer review required
3. **Merge**: Squash merge to `main` with conventional commit message

### Breaking Changes

If your PR introduces a breaking change:

1. Add `💥` to the PR title
2. Document the breaking change in the PR body
3. Explain the migration path for users
4. Breaking changes will be batched into the next major version

---

## 🐛 Reporting Issues

### Bug Reports

Use the [Bug Report template](/.github/ISSUE_TEMPLATE/bug_report.md). Include:

- **Environment**: Node.js version, OS, adapter in use
- **Reproduction steps**: Step-by-step instructions
- **Minimal code example**: The smallest code that reproduces the issue
- **Error output**: Full stack trace and log output

### Feature Requests

Use the [Feature Request template](/.github/ISSUE_TEMPLATE/feature_request.md). Include:

- **Motivation**: Why this feature is needed
- **Proposed API**: How you'd like to use it
- **Adapter scope**: Which adapters are affected

---

## 🏗️ Adding a New Adapter

If you want to contribute a new adapter:

1. Create `src/adapters/<name>/` with these files:
   - `adapter.ts` — implements `VextAdapter` interface
   - `request.ts` — creates `VextRequest` from framework's native request
   - `response.ts` — creates `VextResponse` wrapping framework's native response
   - `index.ts` — exports the factory function

2. Register in `src/lib/adapter-resolver.ts`

3. Add to `src/lib/config-loader.ts` `knownAdapters` list

4. Create `test/unit/adapters/<name>-adapter.test.ts` with full coverage

5. Verify all E2E tests pass with the new adapter

6. Update `src/cli/create.ts` to include the adapter in `VALID_ADAPTERS` and `ADAPTER_DEPS`

---

## 📄 License

By contributing to vextjs, you agree that your contributions will be licensed under the [Apache License 2.0](./LICENSE).

---

**Thank you for helping make vextjs better!** 🚀
