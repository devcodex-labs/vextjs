---
name: 🐛 Bug Report
about: Report a bug to help us improve vext
title: '[Bug] '
labels: bug
assignees: ''
---

## Bug Description

A clear and concise description of what the bug is.

## Reproduction Steps

1. Install vext with `npm install vextjs`
2. Create a project with `vext create my-app`
3. Configure '...'
4. Run '...'
5. See error

## Expected Behavior

A clear and concise description of what you expected to happen.

## Actual Behavior

What actually happened. Include error messages and stack traces if available.

## Minimal Reproduction

```typescript
// Provide the smallest possible code that reproduces the issue
import { defineRoutes } from 'vextjs'

export default defineRoutes((app) => {
  app.get('/', {}, async (req, res) => {
    // ...
  })
})
```

## Environment

- **Node.js version**: (e.g., v22.13.0)
- **vextjs version**: (e.g., 1.0.0)
- **Adapter**: (e.g., hono / fastify / express / koa / native)
- **OS**: (e.g., Windows 11, Ubuntu 24.04, macOS 15)
- **Package manager**: (e.g., npm 10.x, pnpm 9.x)

## Configuration

If applicable, provide your `src/config/default.ts`:

```typescript
// src/config/default.ts
export default {
  port: 3000,
  adapter: 'hono',
  // ...
}
```

## Logs

If applicable, paste relevant log output:

```
[paste logs here]
```

## Additional Context

Add any other context about the problem here (screenshots, related issues, etc.).