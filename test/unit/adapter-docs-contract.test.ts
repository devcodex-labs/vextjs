import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readAdapterDoc(locale: "zh" | "en"): string {
  return readFileSync(
    path.join(process.cwd(), "website", "docs", locale, "guide", "adapters.md"),
    "utf8",
  );
}

describe("adapter docs runtime boundary contract", () => {
  it("does not present the current Hono adapter as official Edge runtime support", () => {
    const zh = readAdapterDoc("zh");
    const en = readAdapterDoc("en");

    expect(zh).toContain(
      "当前内置 Hono Adapter 是 Node.js HTTP server adapter",
    );
    expect(zh).toContain("不等同于官方 Edge / Serverless Adapter 支持");
    expect(zh).not.toContain("全栈 / 边缘运行时");

    expect(en).toContain(
      "current built-in Hono Adapter is a Node.js HTTP server adapter",
    );
    expect(en).toContain(
      "does not represent official Edge / Serverless adapter support",
    );
    expect(en).not.toContain("Full stack / edge runtime");
  });
});
