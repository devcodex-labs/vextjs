import path from "node:path";
import { withProjectOwner } from "./owner.js";
import { artifactRelativePath, readArtifactFile } from "./artifact-manifest.js";
import {
  withArtifactGroupTransaction,
  type ArtifactScopeUpdate,
} from "./artifact-transaction.js";

export type GeneratedFileStatus = "written" | "unchanged" | "stale";
export interface GeneratedFileResult {
  filePath: string;
  status: GeneratedFileStatus;
}
export interface GeneratedFileDraft {
  filePath: string;
  content: string;
  producer: string;
}

/** 生成器只交付候选；CLI 与运行时共享字节比较、归属和多范围提交。 */
export async function publishGeneratedFiles(
  rootDir: string,
  drafts: readonly GeneratedFileDraft[],
  options: { checkOnly?: boolean } = {},
): Promise<GeneratedFileResult[]> {
  if (drafts.length === 0) return [];
  const inspect = (): GeneratedFileResult[] =>
    drafts.map((draft) => {
      const previous = readArtifactFile(
        rootDir,
        artifactRelativePath(rootDir, draft.filePath),
      );
      return {
        filePath: draft.filePath,
        status: previous?.equals(Buffer.from(draft.content))
          ? "unchanged"
          : "stale",
      };
    });
  // 缺失可以标 stale；访问失败、目录和链接等必须保留错误，不能建议覆盖。
  if (options.checkOnly) return inspect();
  const groups = new Map<string, ArtifactScopeUpdate>();
  for (const draft of drafts) {
    const outDir = path.dirname(path.resolve(draft.filePath));
    const key = `${draft.producer}:${outDir}`;
    let group = groups.get(key);
    if (!group) {
      group = { producer: draft.producer, outDir, files: [], mode: "merge" };
      groups.set(key, group);
    }
    group.files = [
      ...group.files,
      { path: draft.filePath, contents: draft.content },
    ];
  }
  const outputs = [...groups.values()];
  return withProjectOwner(
    rootDir,
    "typegen",
    outputs.map((output) => output.outDir),
    () =>
      withArtifactGroupTransaction(
        { rootDir, outputs },
        async (transaction) => {
          const results = inspect();
          await transaction.commit(outputs);
          return results.map((result) => ({
            ...result,
            status: result.status === "stale" ? "written" : result.status,
          }));
        },
      ),
  );
}
