import { fork } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import Redis from "ioredis";
import { expect, it } from "vitest";

it("coordinates real timers in independent application roots and processes through Redis", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vext-job-replicas-"));
  const keyPrefix = `independent-${randomUUID()}:`;
  const url = process.env.VEXT_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
  const children = [];
  const client = new Redis(url);
  client.on("error", () => {});
  try {
    for (const name of ["a", "b"]) {
      const dir = path.join(root, name);
      await mkdir(dir);
      await writeFile(path.join(dir, "package.json"), "{}");
      const child = fork(
        path.join(process.cwd(), "test/fixtures/jobs-redis-replica.mjs"),
        [dir, url, keyPrefix],
        {
          cwd: dir,
          execArgv: [],
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          windowsHide: true,
        },
      );
      let stdout = "",
        stderr = "";
      child.stdout!.on("data", (data) => {
        stdout += String(data);
      });
      child.stderr!.on("data", (data) => {
        stderr += String(data);
      });
      children.push({ child, output: () => ({ stdout, stderr }) });
    }
    await Promise.all(
      children.map(async ({ child }) => {
        await once(child, "message");
      }),
    );
    const exits = children.map(({ child }) => once(child, "exit"));
    for (const { child } of children) child.send({ start: true });
    const results = await Promise.all(exits);
    expect(results.every((result) => result[0] === 0)).toBe(true);
    const summaries = children.map((value) =>
      JSON.parse(value.output().stdout.trim().split("\n").at(-1)!),
    );
    const events = summaries.flatMap((value) => value.events);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(new Set(events.map((value) => value.at)).size).toBe(events.length);
    expect(summaries.every((value) => value.closed)).toBe(true);
    if (process.env.VEXT_JOBS_EVIDENCE_DIR)
      await writeFile(
        path.join(
          process.env.VEXT_JOBS_EVIDENCE_DIR,
          "independent-redis-apps.json",
        ),
        JSON.stringify(
          {
            summaries,
            outputs: children.map((value) => value.output()),
            workersExited: children.every(
              (value) => value.child.exitCode === 0,
            ),
          },
          null,
          2,
        ),
      );
  } finally {
    await Promise.all(
      children
        .filter((value) => value.child.exitCode === null)
        .map(async ({ child }) => {
          const done = once(child, "exit");
          child.kill("SIGKILL");
          await done;
        }),
    );
    const tag = createHash("sha256")
      .update(keyPrefix)
      .update("\0")
      .update("sample")
      .digest("hex");
    await client.del(
      `{${tag}}:${keyPrefix}sample:last`,
      `{${tag}}:${keyPrefix}sample:running`,
    );
    client.disconnect();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
