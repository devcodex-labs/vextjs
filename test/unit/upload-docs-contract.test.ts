import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("upload docs contract", () => {
  it("documents built-in multipart as the primary req.files path", () => {
    const requestTypes = readRepoFile("src/types/request.ts");
    const enContext = readRepoFile("website/docs/en/api/context.md");
    const zhContext = readRepoFile("website/docs/zh/api/context.md");

    expect(requestTypes).toContain(
      "由内置 multipart 解析器或自定义上传插件填充",
    );
    expect(requestTypes).toContain("RouteOptions.multipart");
    expect(requestTypes).not.toContain("框架本身不包含 multipart 解析逻辑");
    expect(requestTypes).not.toContain("需在路由或全局注册 multipart 解析插件");

    expect(enContext).toContain(
      "built-in multipart parsing is enabled globally",
    );
    expect(enContext).toContain("multipart.enabled: true");
    expect(enContext).toContain("multipart.enabled: false");
    expect(enContext).not.toContain("multipart plug-in parses");

    expect(zhContext).toContain("全局 `config.multipart.enabled` 开启后");
    expect(zhContext).toContain("`multipart.enabled: true`");
    expect(zhContext).toContain("`multipart.enabled: false`");
    expect(zhContext).not.toContain("需配合文件上传插件");
  });

  it("keeps route-level upload docs aligned with parser and OpenAPI behavior", () => {
    const docs = [
      readRepoFile("website/docs/en/api/route-definition.md"),
      readRepoFile("website/docs/zh/api/route-definition.md"),
      readRepoFile("website/docs/en/guide/plugins.md"),
      readRepoFile("website/docs/zh/guide/plugins.md"),
    ];

    for (const doc of docs) {
      expect(doc).toContain("multipart/form-data");
      expect(doc).toContain("enabled: true");
      expect(doc).toContain("enabled: false");
      expect(doc).toContain("maxFileSize");
      expect(doc).toContain("maxFiles");
      expect(doc).toContain("allowedMimeTypes");
      expect(doc).toContain("required");
    }

    expect(
      readRepoFile("website/docs/en/api/route-definition.md"),
    ).not.toContain('middlewares: ["upload"]');
    expect(
      readRepoFile("website/docs/zh/api/route-definition.md"),
    ).not.toContain('middlewares: ["upload"]');
  });
});
