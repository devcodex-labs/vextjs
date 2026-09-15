import { readProjectFile } from "../../lib/project/read-project-file.js";
import {
  inspectProjectDependencies,
  type ProjectDependencyFact,
} from "../../tooling/project-index/dependencies.js";

/** 与 project inspect 共用元信息解析器；知识搜索不触发全项目采集或网络连接。 */
export function inspectKnowledgeDependencies(
  rootDir: string,
  signal?: AbortSignal,
): {
  facts: ProjectDependencyFact[];
  digest: string | null;
  issue: string | null;
} {
  try {
    signal?.throwIfAborted();
    const bytes = readProjectFile(rootDir, "package.json", 256 * 1024);
    if (!bytes)
      return {
        facts: [],
        digest: null,
        issue:
          "Project package.json is unavailable; installed versions remain unverified.",
      };
    const manifest: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
      throw new Error("Project package.json must be an object.");
    const result = inspectProjectDependencies(
      rootDir,
      manifest as Record<string, unknown>,
      signal,
    );
    const current = readProjectFile(rootDir, "package.json", 256 * 1024);
    if (!current || !Buffer.from(current).equals(Buffer.from(bytes)))
      throw new Error(
        "Project package.json changed during dependency inspection; retry.",
      );
    return { ...result, issue: null };
  } catch (error) {
    signal?.throwIfAborted();
    return { facts: [], digest: null, issue: String(error) };
  }
}
