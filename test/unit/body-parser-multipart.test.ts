import { describe, expect, it, vi } from "vitest";
import { createRouteMultipartMiddleware } from "../../src/lib/middlewares/body-parser.js";
import type { ParsedFile, VextRequest } from "../../src/types/request.js";

function createFile(
  fieldname: string,
  filename = `${fieldname}.txt`,
): ParsedFile {
  return {
    fieldname,
    filename,
    mimetype: "text/plain",
    buffer: Buffer.from("hello"),
    size: 5,
  };
}

function createMultipartBody(boundary: string, fieldname: string): Buffer {
  return Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${fieldname}"; filename="${fieldname}.txt"`,
      "Content-Type: text/plain",
      "",
      "hello",
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  );
}

function createReq(
  overrides: Partial<VextRequest> & { rawBody?: Buffer } = {},
): VextRequest {
  const boundary = "----vext-test-boundary";
  const rawBody = overrides.rawBody ?? createMultipartBody(boundary, "avatar");
  const req = {
    requestId: "req-1",
    method: "POST",
    url: "/upload",
    path: "/upload",
    route: "/upload",
    query: {},
    params: {},
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    cookies: {},
    cookie: vi.fn(),
    body: undefined,
    app: {} as any,
    ip: "127.0.0.1",
    protocol: "http",
    valid: vi.fn(),
    onClose: vi.fn(),
    _getRawBody: vi.fn(),
    _getRawBodyBuffer: vi.fn(async () => rawBody),
    ...overrides,
  };
  delete (req as { rawBody?: Buffer }).rawBody;
  return req as VextRequest;
}

function createRes() {
  return {
    rawJson: vi.fn(),
  };
}

describe("route multipart middleware", () => {
  it("rejects missing required file fields after global multipart parsing", async () => {
    const middleware = createRouteMultipartMiddleware({
      enabled: true,
      files: {
        avatar: { description: "Avatar", required: true },
        thumbnail: "Optional thumbnail",
      },
    });
    const req = createReq({ files: [createFile("thumbnail")] });
    const res = createRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.rawJson).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 400,
        message: "Missing required multipart file field(s): avatar",
        requestId: "req-1",
      }),
      400,
    );
  });

  it("rejects missing required file fields after route-level parsing", async () => {
    const boundary = "----vext-test-boundary";
    const middleware = createRouteMultipartMiddleware({
      enabled: true,
      files: {
        avatar: { description: "Avatar", required: true },
        document: "Optional document",
      },
    });
    const req = createReq({
      rawBody: createMultipartBody(boundary, "document"),
    });
    const res = createRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.rawJson).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 400,
        message: "Missing required multipart file field(s): avatar",
        requestId: "req-1",
      }),
      400,
    );
  });

  it("allows optional and undeclared file fields when required fields are present", async () => {
    const middleware = createRouteMultipartMiddleware({
      enabled: true,
      files: {
        avatar: { description: "Avatar", required: true },
        thumbnail: "Optional thumbnail",
      },
    });
    const req = createReq({
      files: [createFile("avatar"), createFile("extra")],
    });
    const res = createRes();
    const next = vi.fn();

    await middleware(req, res as any, next);

    expect(res.rawJson).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
