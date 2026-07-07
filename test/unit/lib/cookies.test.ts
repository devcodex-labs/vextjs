import { describe, expect, it } from "vitest";
import {
  parseCookies,
  serializeClearCookie,
  serializeCookie,
} from "../../../src/lib/cookies.js";

describe("cookies", () => {
  it("parses Cookie header with first-wins duplicate semantics", () => {
    expect(parseCookies("theme=dark; sid=one; sid=two")).toEqual({
      theme: "dark",
      sid: "one",
    });
  });

  it("returns a readonly cookie jar", () => {
    const cookies = parseCookies("theme=dark");

    expect(Object.isFrozen(cookies)).toBe(true);
    expect(() => {
      (cookies as Record<string, string>).theme = "light";
    }).toThrow();
    expect(cookies.theme).toBe("dark");
  });

  it("supports custom decode", () => {
    expect(
      parseCookies("payload=hello+world", {
        decode: (value) => value.replace(/\+/g, " "),
      }),
    ).toEqual({ payload: "hello world" });
  });

  it("serializes Set-Cookie attributes", () => {
    expect(
      serializeCookie("sid", "hello world", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60,
      }),
    ).toBe(
      "sid=hello%20world; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("serializes modern attributes and custom encode", () => {
    expect(
      serializeCookie("sid", "hello world", {
        encode: (value) => value.replace(" ", "+"),
        priority: "high",
        partitioned: true,
      }),
    ).toBe("sid=hello+world; Priority=High; Partitioned");
  });

  it("serializes clear cookie as an expired cookie", () => {
    expect(serializeClearCookie("sid", { path: "/" })).toContain(
      "sid=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
  });

  it("rejects invalid cookie names", () => {
    expect(() => serializeCookie("bad name", "value")).toThrow(
      /Invalid cookie name/,
    );
  });
});
