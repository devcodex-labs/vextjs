/**
 * error-overlay.ts 单元测试
 *
 * 测试覆盖：
 *   - escapeHtml：HTML 特殊字符转义
 *   - parseStackTrace：V8 堆栈格式解析（带函数名 / 无函数名 / Windows 路径 / node: 内置 / 空 stack）
 *   - isUserFrame：用户帧 / node_modules / .vext/dev / node: 内置帧
 *   - getSourceContext：正常读取 / 文件不存在 / 行号边界
 *   - renderDevErrorPage：TypeError → 500 / HttpError → 4xx / VextValidationError → val-section
 *                         / XSS 转义 / 非 Error 对象 / 主题切换 / maxFrames 截断
 *
 * @see src/lib/dev/error-overlay.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  escapeHtml,
  parseStackTrace,
  isUserFrame,
  getSourceContext,
  renderDevErrorPage,
} from "../../../src/lib/dev/error-overlay.js";

// ── escapeHtml ───────────────────────────────────────────────

describe("escapeHtml", () => {
  it("转义 & < > \" '", () => {
    expect(escapeHtml('<script>alert("xss")&\'</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&amp;&#39;&lt;/script&gt;",
    );
  });

  it("普通文本不变", () => {
    expect(escapeHtml("hello world 123")).toBe("hello world 123");
  });

  it("空字符串不变", () => {
    expect(escapeHtml("")).toBe("");
  });
});

// ── parseStackTrace ──────────────────────────────────────────

describe("parseStackTrace", () => {
  it("解析 'at fn (file:line:col)' 格式", () => {
    const stack = `Error: test
    at getUserHandler (E:/project/src/routes/user.ts:12:8)
    at processRequest (E:/project/src/middleware/auth.ts:34:5)`;
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      fn: "getUserHandler",
      file: "E:/project/src/routes/user.ts",
      line: 12,
      col: 8,
    });
    expect(frames[1]).toMatchObject({
      fn: "processRequest",
      file: "E:/project/src/middleware/auth.ts",
      line: 34,
      col: 5,
    });
  });

  it("解析 'at file:line:col' 格式（无函数名）", () => {
    const stack = `Error: anon
    at E:/project/src/handler.ts:5:3`;
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      fn: "<anonymous>",
      file: "E:/project/src/handler.ts",
      line: 5,
      col: 3,
    });
  });

  it("解析嵌套调用（含括号方法名）", () => {
    const stack = `Error: x
    at Object.<anonymous> (/home/user/src/index.ts:1:1)`;
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.fn).toContain("anonymous");
  });

  it("node: 内置模块帧被解析（含 node: 前缀）", () => {
    const stack = `Error: x
    at readFileSync (node:fs:441:20)`;
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.file).toBe("node:fs");
  });

  it("空 stack 返回空数组", () => {
    expect(parseStackTrace("")).toHaveLength(0);
    expect(parseStackTrace(undefined as unknown as string)).toHaveLength(0);
  });

  it("Windows 反斜杠路径（含盘符）正确解析", () => {
    const stack = `Error: x
    at handler (C:\\project\\src\\routes\\user.ts:10:5)`;
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.file).toContain("user.ts");
    expect(frames[0]!.line).toBe(10);
  });

  it("混合格式（带换行的错误消息）正确解析", () => {
    const stack = `TypeError: Cannot read properties of undefined (reading 'name')
    at getUser (E:/src/user.ts:5:10)
    at async Server.<anonymous> (node:http:700:5)`;
    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.fn).toBe("getUser");
  });
});

// ── isUserFrame ──────────────────────────────────────────────

describe("isUserFrame", () => {
  const root = "/home/user/project";

  it("项目内用户代码帧 → true", () => {
    expect(
      isUserFrame({ fn: "handler", file: "/home/user/project/src/routes/user.ts", line: 5, col: 3 }, root),
    ).toBe(true);
  });

  it("项目内深层路径 → true", () => {
    expect(
      isUserFrame({ fn: "fn", file: "/home/user/project/src/services/auth.ts", line: 1, col: 1 }, root),
    ).toBe(true);
  });

  it("node_modules 帧 → false", () => {
    expect(
      isUserFrame(
        { fn: "fn", file: "/home/user/project/node_modules/express/index.js", line: 1, col: 1 },
        root,
      ),
    ).toBe(false);
  });

  it(".vext/dev/ 编译产物帧 → false", () => {
    expect(
      isUserFrame(
        { fn: "fn", file: "/home/user/project/.vext/dev/routes/user.js", line: 1, col: 1 },
        root,
      ),
    ).toBe(false);
  });

  it("node: 内置模块帧 → false", () => {
    expect(isUserFrame({ fn: "fn", file: "node:fs", line: 1, col: 1 }, root)).toBe(false);
  });

  it("项目外路径 → false", () => {
    expect(
      isUserFrame({ fn: "fn", file: "/other/project/src/file.ts", line: 1, col: 1 }, root),
    ).toBe(false);
  });

  it("同前缀但不同项目（B1 修复：防止前缀假阳性）→ false", () => {
    // root = "/home/user/project"，文件在 "/home/user/project-other/..."
    expect(
      isUserFrame({ fn: "fn", file: "/home/user/project-other/src/file.ts", line: 1, col: 1 }, root),
    ).toBe(false);
  });
});

// ── getSourceContext ─────────────────────────────────────────

describe("getSourceContext", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vext-overlay-test-"));
    tmpFile = path.join(tmpDir, "test.ts");
    // 写入 10 行内容
    const lines = Array.from({ length: 10 }, (_, i) => `const line${i + 1} = ${i + 1};`);
    fs.writeFileSync(tmpFile, lines.join("\n"), "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("正常读取：返回 errorLine ±3 行上下文", () => {
    const ctx = getSourceContext(tmpFile, 5);
    expect(ctx).not.toBeNull();
    expect(ctx!.lines.length).toBeGreaterThanOrEqual(4);
    const errorLines = ctx!.lines.filter((l) => l.isError);
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]!.num).toBe(5);
  });

  it("文件不存在 → 返回 null（E2）", () => {
    expect(getSourceContext("/nonexistent/path/file.ts", 5)).toBeNull();
  });

  it("行号在文件头部（第1行）不越界", () => {
    const ctx = getSourceContext(tmpFile, 1);
    expect(ctx).not.toBeNull();
    expect(ctx!.lines[0]!.num).toBe(1);
    expect(ctx!.lines[0]!.isError).toBe(true);
  });

  it("行号在文件尾部（第10行）不越界", () => {
    const ctx = getSourceContext(tmpFile, 10);
    expect(ctx).not.toBeNull();
    const last = ctx!.lines[ctx!.lines.length - 1]!;
    expect(last.num).toBe(10);
  });

  it("行号为 0 → 返回 null（E12）", () => {
    expect(getSourceContext(tmpFile, 0)).toBeNull();
  });

  it("行号为 NaN → 返回 null（E12）", () => {
    expect(getSourceContext(tmpFile, NaN)).toBeNull();
  });
});

// ── renderDevErrorPage ───────────────────────────────────────

describe("renderDevErrorPage", () => {
  const projectRoot = "/home/user/project";

  it("TypeError → 500 badge", () => {
    const err = new TypeError("Cannot read properties of undefined");
    const html = renderDevErrorPage(err, projectRoot);
    expect(html).toContain("500 Internal Server Error");
    expect(html).toContain("TypeError");
    expect(html).toContain("Cannot read properties of undefined");
    expect(html).toContain("badge-500");
  });

  it("HttpError 404 → 4xx badge", () => {
    const err = Object.assign(new Error("Not Found"), {
      name: "HttpError",
      status: 404,
    });
    const html = renderDevErrorPage(err, projectRoot);
    expect(html).toContain("404");
    expect(html).toContain("badge-4xx");
  });

  it("VextValidationError → val-section 渲染", () => {
    const err = Object.assign(new Error("Validation failed"), {
      name: "VextValidationError",
      errors: [
        { field: "email", message: "邮箱格式不正确" },
        { field: "age", message: "必须为正整数" },
      ],
    });    const html = renderDevErrorPage(err, projectRoot);
    expect(html).toContain("Validation Errors");
    expect(html).toContain("email");
    expect(html).toContain("邮箱格式不正确");
    expect(html).toContain("age");
    expect(html).toContain("422");
  });

  it("VextValidationError.errors 为空 → 不渲染 val-section（E15）", () => {
    const err = Object.assign(new Error("Validation failed"), {
      name: "VextValidationError",
      errors: [],
    });
    const html = renderDevErrorPage(err, projectRoot);
    expect(html).not.toContain("Validation Errors");
  });

  it("XSS 字符在错误消息中被转义", () => {
    const err = new Error('<script>alert("xss")</script>');
    const html = renderDevErrorPage(err, projectRoot);
    // error-message 区域中，消息内容必须被转义（&lt;script&gt; 而非 <script>）
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    // 标题区同样转义
    expect(html).toContain("&lt;script&gt;alert");
  });

  it("非 Error 对象（throw 'string'）→ 包装为 Error（E14）", () => {
    const html = renderDevErrorPage("plain string error", projectRoot);
    expect(html).toContain("plain string error");
    expect(html).toContain("500");
  });

  it("light 主题 → 包含浅色背景色", () => {
    const err = new Error("test");
    const html = renderDevErrorPage(err, projectRoot, { theme: "light" });
    expect(html).toContain("#f9fafb"); // LIGHT_THEME.bg
  });

  it("dark 主题（默认）→ 包含深色背景色", () => {
    const err = new Error("test");
    const html = renderDevErrorPage(err, projectRoot, { theme: "dark" });
    expect(html).toContain("#0d0d0d"); // DARK_THEME.bg
  });

  it("maxFrames 截断堆栈帧数", () => {
    // 构造有 30 帧的 Error（通过拼接 stack）
    const fakeStack =
      "Error: deep\n" +
      Array.from(
        { length: 30 },
        (_, i) => `    at fn${i} (/home/user/project/src/file.ts:${i + 1}:1)`,
      ).join("\n");
    const err = new Error("deep");
    err.stack = fakeStack;

    const html5 = renderDevErrorPage(err, projectRoot, { maxFrames: 5 });
    // 最多 5 帧，所以 fn6 不应出现
    expect(html5).not.toContain("fn29");
  });

  it("输出是合法 HTML（含 DOCTYPE 和 </html>）", () => {
    const err = new Error("basic");
    const html = renderDevErrorPage(err, projectRoot);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("</html>");
  });
});

