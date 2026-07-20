/**
 * Cluster IPC 文档契约测试
 *
 * 防止中英文 Cluster 文档中的 IPC message type 与运行时 ipc-types.ts 漂移。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractRuntimeMessageTypes(
  source: string,
  direction: "Worker" | "Master",
): string[] {
  return [
    ...source.matchAll(
      new RegExp(
        `export interface ${direction}[A-Za-z]+Message \\{[\\s\\S]*?type: "([^"]+)";`,
        "gu",
      ),
    ),
  ].map((match) => match[1]!);
}

function extractDocumentedMessageTypes(
  docs: string,
  heading: string,
  nextHeading: string,
): string[] {
  const start = docs.indexOf(heading);
  const end = docs.indexOf(nextHeading, start + heading.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return [...docs.slice(start, end).matchAll(/\| `([^`]+)`/gu)].map(
    (match) => match[1]!,
  );
}

describe("Cluster IPC docs contract", () => {
  const ipcTypes = readRepoFile("src/lib/cluster/ipc-types.ts");
  const runtimeWorkerToMaster = extractRuntimeMessageTypes(ipcTypes, "Worker");
  const runtimeMasterToWorker = extractRuntimeMessageTypes(ipcTypes, "Master");

  it("zh Cluster guide lists exact runtime IPC type literals", () => {
    const docs = readRepoFile("website/docs/zh/guide/cluster.md");

    expect(
      extractDocumentedMessageTypes(
        docs,
        "### Worker → Master 消息",
        "### Master → Worker 消息",
      ),
    ).toEqual(runtimeWorkerToMaster);
    expect(
      extractDocumentedMessageTypes(
        docs,
        "### Master → Worker 消息",
        "## 与 Docker 部署",
      ),
    ).toEqual(runtimeMasterToWorker);
    expect(docs).not.toMatch(/`(?:worker|master):/u);
    expect(docs).toContain('type: "ready"');
    expect(docs).toContain('type: "shutdown"');
  });

  it("en Cluster guide lists exact runtime IPC type literals", () => {
    const docs = readRepoFile("website/docs/en/guide/cluster.md");

    expect(
      extractDocumentedMessageTypes(
        docs,
        "### Worker → Master message",
        "### Master → Worker message",
      ),
    ).toEqual(runtimeWorkerToMaster);
    expect(
      extractDocumentedMessageTypes(
        docs,
        "### Master → Worker message",
        "## Deploying with Docker",
      ),
    ).toEqual(runtimeMasterToWorker);
    expect(docs).not.toMatch(/`(?:worker|master):/u);
    expect(docs).toContain('type: "ready"');
    expect(docs).toContain('type: "shutdown"');
  });
});
