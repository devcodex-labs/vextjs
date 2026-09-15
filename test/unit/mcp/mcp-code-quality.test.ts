import { describe, expect, it } from "vitest";
import { inspectSourceQuality } from "../../../src/tooling/diagnostics/code-quality.js";

describe("source quality facts", () => {
  it("ignores misleading strings and comments while detecting a real constant assertion", () => {
    expect(
      inspectSourceQuality(
        "test/blog.test.ts",
        `const example = 'expect(true).toBe(true)'; /* interface Collection {} */`,
      ).placeholderAssertion,
    ).toBe(false);
    expect(
      inspectSourceQuality(
        "test/blog.test.ts",
        `import { expect } from 'vitest'; expect(true).toBe(true);`,
      ).placeholderAssertion,
    ).toBe(true);
    expect(
      inspectSourceQuality(
        "test/blog.test.ts",
        `function expect(value) { return value; } expect(1).toBe(1);`,
      ).placeholderAssertion,
    ).toBe(false);
  });

  it("keeps JSX attributes on their own form and detects imported eager adapter aliases", () => {
    expect(
      inspectSourceQuality(
        "src/frontend/pages/index.tsx",
        `export default () => <><form method="post" /><form action="/api/blog" /></>;`,
      ).apiForm,
    ).toBe(false);
    expect(
      inspectSourceQuality(
        "src/frontend/pages/index.tsx",
        `export default () => <form method="post" action="/api/blog" />;`,
      ).apiForm,
    ).toBe(true);
    expect(
      inspectSourceQuality(
        "src/config/default.ts",
        `import { createRedisCacheAdapter as adapter } from 'vextjs'; export default { cache: adapter({}) };`,
      ).eagerRedisAdapter,
    ).toBe(true);
    expect(
      inspectSourceQuality(
        "src/config/default.ts",
        `import { createRedisCacheAdapter as adapter } from 'vextjs'; export default () => ({ cache: adapter({}) });`,
      ).eagerRedisAdapter,
    ).toBe(false);
    expect(
      inspectSourceQuality(
        "src/config/default.ts",
        `const createRedisCacheAdapter = () => ({}); export default { cache: createRedisCacheAdapter() };`,
      ).eagerRedisAdapter,
    ).toBe(false);
  });
});
