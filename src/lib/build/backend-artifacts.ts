import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { ArtifactCandidate } from "../project/artifact-transaction.js";
import type { FrontendLayoutInput } from "../project/layout.js";
import { assertPathInside, assertRealPathInside } from "../path-boundary.js";
import { backendSourceIgnore } from "./shared-esbuild-config.js";
import { backendOutputPath } from "./backend-module-plugin.js";

/** package/tsconfig 是编译元数据，不作为可部署业务 JSON 复制。 */
export const BACKEND_JSON_IGNORE = [
  "**/package.json",
  "**/tsconfig.json",
  "**/tsconfig.*.json",
];

export async function scanBackendJsonFiles(
  rootDir: string,
  srcDir: string,
  frontend?: FrontendLayoutInput,
  extraIgnore: string[] = [],
): Promise<string[]> {
  return (
    await fg.glob("**/*.json", {
      cwd: srcDir,
      ignore: [
        ...backendSourceIgnore(rootDir, srcDir, frontend),
        ...BACKEND_JSON_IGNORE,
        ...extraIgnore,
      ],
    })
  ).sort();
}

export function backendArtifactCandidates(
  srcDir: string,
  outDir: string,
  entries: readonly string[],
  compiled: readonly { path: string; contents: Uint8Array }[],
  jsonFiles: readonly string[] = [],
): ArtifactCandidate[] {
  const sources = new Map<string, string>();
  for (const entry of entries) {
    const source = assertPathInside(
      srcDir,
      path.resolve(srcDir, entry),
      "backend source",
    );
    assertRealPathInside(srcDir, source, "backend source");
    const output = path.resolve(outDir, backendOutputPath(entry));
    sources.set(output, source);
    sources.set(`${output}.map`, source);
  }
  const artifacts: ArtifactCandidate[] = compiled.map((output) => ({
    ...output,
    source: sources.get(path.resolve(output.path)),
  }));
  for (const entry of jsonFiles) {
    const source = assertPathInside(
      srcDir,
      path.resolve(srcDir, entry),
      "backend JSON source",
    );
    assertRealPathInside(srcDir, source, "backend JSON source");
    const contents = fs.readFileSync(source);
    try {
      JSON.parse(contents.toString("utf8").replace(/^\uFEFF/u, ""));
    } catch (error) {
      throw new Error(
        `[vextjs] Invalid backend JSON ${source}: ${String(error)}`,
      );
    }
    artifacts.push({ path: path.resolve(outDir, entry), source, contents });
  }
  return artifacts;
}
