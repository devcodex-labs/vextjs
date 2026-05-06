import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type GeneratedFileStatus = "written" | "unchanged" | "stale";

export interface GeneratedFileResult {
  filePath: string;
  status: GeneratedFileStatus;
}

export async function writeGeneratedFile(
  filePath: string,
  content: string,
  options: { checkOnly?: boolean } = {},
): Promise<GeneratedFileResult> {
  const { checkOnly = false } = options;

  let currentContent: string | null = null;
  try {
    currentContent = await readFile(filePath, "utf-8");
  } catch {
    currentContent = null;
  }

  if (currentContent === content) {
    return { filePath, status: "unchanged" };
  }

  if (checkOnly) {
    return { filePath, status: "stale" };
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  return { filePath, status: "written" };
}

