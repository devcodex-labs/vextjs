import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import {
  createFileJobStore,
  createMemoryJobStore,
} from "../../../src/lib/jobs/stores/index.js";
import { jobStoreCompletionCases } from "../../helpers/job-store-completion-cases.js";

describe.each(["memory", "file"] as const)(
  "%s Job completion contract",
  (kind) => {
    it.each(jobStoreCompletionCases)("$name", async ({ run }) => {
      const root =
        kind === "file"
          ? await mkdtemp(path.join(tmpdir(), "vext-job-completion-"))
          : undefined;
      const store = root
        ? createFileJobStore({ rootDir: root })
        : createMemoryJobStore();
      try {
        await store.init?.();
        await run(store);
      } finally {
        try {
          await store.close?.();
        } finally {
          if (
            root &&
            path.dirname(root) === path.resolve(tmpdir()) &&
            path.basename(root).startsWith("vext-job-completion-")
          ) {
            await rm(root, { recursive: true, force: true });
          }
        }
      }
    });
  },
);
