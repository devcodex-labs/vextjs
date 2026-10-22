import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Jobs IPC over actual Worker channels", () => {
  it.each([
    "normal",
    "drop-claim",
    "drop-offer",
    "drop-accept",
    "late-permit",
    "drop-ack",
    "manifest-mismatch",
    "crash-running",
    "disconnect-running",
    "crash-reserved",
    "crash-permitted",
    "busy-period",
    "dst",
    "long-pause",
  ])("fails closed through %s", async (scenario) => {
    const result = await promisify(execFile)(
      process.execPath,
      ["test/fixtures/jobs-ipc-faults.mjs", scenario],
      { cwd: process.cwd(), timeout: 20000, windowsHide: true },
    );
    const summary = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
    expect(summary).toMatchObject({
      scenario,
      status: "PASS",
      workersExited: true,
    });
    for (const pid of summary.owned)
      expect(() => process.kill(pid, 0)).toThrow();
    if (process.env.VEXT_JOBS_EVIDENCE_DIR)
      await writeFile(
        path.join(
          process.env.VEXT_JOBS_EVIDENCE_DIR,
          `ipc-fault-${scenario}.json`,
        ),
        JSON.stringify(
          { ...summary, stdout: result.stdout, stderr: result.stderr },
          null,
          2,
        ),
      );
  });
});
