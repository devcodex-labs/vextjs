import { describe, expect, it } from "vitest";
import {
  normalizeRedirectLocation,
  normalizeRedirectStatus,
  prepareRedirect,
} from "../../../src/lib/redirect.js";

describe("normalizeRedirectStatus", () => {
  it.each([301, 302, 303, 307, 308] as const)(
    "keeps allowed status %s",
    (status) => {
      expect(normalizeRedirectStatus(status)).toBe(status);
    },
  );

  it("defaults missing status to 302", () => {
    expect(normalizeRedirectStatus()).toBe(302);
    expect(normalizeRedirectStatus(undefined)).toBe(302);
    expect(normalizeRedirectStatus(null)).toBe(302);
  });

  it("coerces invalid statuses (e.g. 999) to 302", () => {
    expect(normalizeRedirectStatus(999)).toBe(302);
    expect(normalizeRedirectStatus(200)).toBe(302);
    expect(normalizeRedirectStatus(0)).toBe(302);
    expect(normalizeRedirectStatus(-1)).toBe(302);
    expect(normalizeRedirectStatus(301.5)).toBe(302);
    expect(normalizeRedirectStatus(Number.NaN)).toBe(302);
  });
});

describe("normalizeRedirectLocation", () => {
  it("leaves ASCII paths and absolute URLs unchanged", () => {
    expect(normalizeRedirectLocation("/next")).toBe("/next");
    expect(normalizeRedirectLocation("https://example.com/a?b=1#c")).toBe(
      "https://example.com/a?b=1#c",
    );
    expect(normalizeRedirectLocation("//cdn.example.com/x")).toBe(
      "//cdn.example.com/x",
    );
  });

  it("percent-encodes non-ASCII path segments without re-encoding ASCII", () => {
    expect(normalizeRedirectLocation("/中文")).toBe("/%E4%B8%AD%E6%96%87");
    expect(normalizeRedirectLocation("/path/你好")).toBe(
      "/path/%E4%BD%A0%E5%A5%BD",
    );
    expect(normalizeRedirectLocation("https://example.com/中文?q=值")).toBe(
      "https://example.com/%E4%B8%AD%E6%96%87?q=%E5%80%BC",
    );
  });

  it("preserves already-percent-encoded sequences", () => {
    expect(normalizeRedirectLocation("/%E4%B8%AD%E6%96%87")).toBe(
      "/%E4%B8%AD%E6%96%87",
    );
    expect(normalizeRedirectLocation("/a%2Fb?x=%20y")).toBe("/a%2Fb?x=%20y");
  });

  it("rejects CR/LF/NUL instead of hanging or encoding them away", () => {
    expect(() => normalizeRedirectLocation("/a\r\nb")).toThrow(TypeError);
    expect(() => normalizeRedirectLocation("/a\nb")).toThrow(
      /must not contain CR, LF, or NUL/,
    );
    expect(() => normalizeRedirectLocation("/a\rb")).toThrow(TypeError);
    expect(() => normalizeRedirectLocation("x\u0000y")).toThrow(TypeError);
  });

  it("rejects non-string locations", () => {
    expect(() =>
      normalizeRedirectLocation(null as unknown as string),
    ).toThrow(TypeError);
    expect(() =>
      normalizeRedirectLocation(123 as unknown as string),
    ).toThrow(TypeError);
  });
});

describe("prepareRedirect", () => {
  it("returns encoded location and coerced status together", () => {
    expect(prepareRedirect("/中文", 999)).toEqual({
      location: "/%E4%B8%AD%E6%96%87",
      status: 302,
    });
    expect(prepareRedirect("/ok", 303)).toEqual({
      location: "/ok",
      status: 303,
    });
  });

  it("fails before any adapter mark-sent when Location is unsafe", () => {
    expect(() => prepareRedirect("/evil\r\nSet-Cookie: a=1", 301)).toThrow(
      TypeError,
    );
  });
});
