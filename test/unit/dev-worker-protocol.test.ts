import { describe, expect, it } from "vitest";
import {
  readWorkerOperationRequest,
  readWorkerOperationResponse,
  readWorkerFiles,
} from "../../src/lib/dev/worker-protocol.js";

const requestId = "e643c1a9-681c-4a64-b5ec-076f0491d63b";
describe("dev worker IPC contract", () => {
  it("copies finite requests and rejects path escapes and oversized frames", () => {
    const request = {
      type: "dev-operation",
      requestId,
      operation: "reload",
      files: [{ path: "src/routes/a.ts", type: "modify" }],
    };
    expect(readWorkerOperationRequest(request)).toEqual(request);
    expect(readWorkerOperationRequest(request)?.files).not.toBe(request.files);
    for (const path of [
      "../other/x.ts",
      "src/../../other",
      "/outside",
      "C:/outside",
      "src\\x.ts",
      "src/./x.ts",
      "src//x.ts",
    ])
      expect(readWorkerFiles([{ path, type: "modify" }])).toBeNull();
    expect(
      readWorkerOperationRequest({ ...request, operation: "execute" }),
    ).toBeNull();
    expect(
      readWorkerOperationRequest({ ...request, script: "run()" }),
    ).toBeNull();
    expect(readWorkerFiles(Array(5001).fill(request.files[0]))).toBeNull();
    expect(readWorkerOperationRequest({ ...request, files: [] })).toBeNull();
    expect(
      readWorkerOperationRequest({ ...request, requestId: "1" }),
    ).toBeNull();
  });

  it("success cannot carry failure fields and failure requires actual evidence", () => {
    const ok = { type: "dev-operation-result", requestId, success: true };
    const failure = {
      ...ok,
      success: false,
      error: "compile failed",
      requestedColdRestart: false,
    };
    expect(readWorkerOperationResponse(ok)).toEqual(ok);
    expect(readWorkerOperationResponse(failure)).toEqual(failure);
    expect(readWorkerOperationResponse({ ...ok, error: "failed" })).toBeNull();
    expect(
      readWorkerOperationResponse({ ...failure, error: undefined }),
    ).toBeNull();
    expect(
      readWorkerOperationResponse({
        ...failure,
        requestedColdRestart: undefined,
      }),
    ).toBeNull();
    expect(
      readWorkerOperationResponse({ ...ok, success: "queued" }),
    ).toBeNull();
  });
});
