---
name: ✨ Feature Request
about: Suggest a new feature or improvement for vext
title: '[Feature] '
labels: enhancement
assignees: ''
---

## Feature Description

A clear and concise description of the feature you'd like to see.

## Motivation

Why is this feature needed? What problem does it solve?

## Proposed Solution

Describe your proposed solution or API design.

### Example Usage

```typescript
// Show how you'd like to use this feature
import { defineRoutes } from 'vextjs'

export default defineRoutes((app) => {
  // Example of the proposed API
})
```

### Configuration (if applicable)

```typescript
// src/config/default.ts
export default {
  // Any new config options needed
}
```

## Alternatives Considered

Describe any alternative solutions or features you've considered.

## Additional Context

- **Adapter scope**: Does this apply to all adapters or specific ones? (hono / fastify / express / koa / native)
- **Breaking change**: Would this require a breaking change?
- **Related issues**: Link any related issues or discussions

## Checklist

- [ ] I have searched existing issues to ensure this feature hasn't been requested
- [ ] I have considered backward compatibility
- [ ] I am willing to submit a PR for this feature (optional)