import { describe, expect, it } from "vitest";
import { buildAttachmentContentDisposition } from "../../../src/lib/content-disposition.js";

describe("buildAttachmentContentDisposition", () => {
  it("keeps the historical header shape for ASCII-safe filenames", () => {
    expect(buildAttachmentContentDisposition("report.txt")).toBe(
      'attachment; filename="report.txt"',
    );
  });

  it("adds an RFC 5987 filename* value for non-ASCII filenames", () => {
    expect(buildAttachmentContentDisposition("resume-张三.pdf")).toBe(
      "attachment; filename=\"resume-__.pdf\"; filename*=UTF-8''resume-%E5%BC%A0%E4%B8%89.pdf",
    );
  });

  it("sanitizes control characters and path separators before writing headers", () => {
    const header = buildAttachmentContentDisposition(
      String.raw`..\evil` + "\r\nSet-Cookie: sid=1.txt",
    );

    expect(header).not.toMatch(/[\r\n]/);
    expect(header).not.toContain("\\");
    expect(header).toBe(
      "attachment; filename=\".._evil__Set-Cookie: sid=1.txt\"; filename*=UTF-8''.._evil__Set-Cookie%3A%20sid%3D1.txt",
    );
  });

  it("escapes quoted-string delimiters in the ASCII fallback", () => {
    expect(buildAttachmentContentDisposition('invoice";2026.csv')).toBe(
      "attachment; filename=\"invoice__2026.csv\"; filename*=UTF-8''invoice%22%3B2026.csv",
    );
  });
});
