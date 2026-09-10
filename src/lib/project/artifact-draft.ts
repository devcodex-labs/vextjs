import path from "node:path";
import { isPathInside } from "../path-boundary.js";
import {
  ArtifactError,
  MAX_ARTIFACT_FILES,
  artifactPath,
  artifactRelativePath,
} from "./artifact-manifest.js";
import { artifactFileKey } from "./artifact-scope.js";
import type {
  ArtifactCandidate,
  ArtifactScopeTarget,
  ArtifactScopeUpdate,
} from "./artifact-transaction.js";

/** 本代生成物；逻辑路径保持不变，缺失候选绝不回退到上一代磁盘输出。 */
export class ArtifactDraft {
  private readonly candidates = new Map<string, ArtifactCandidate>();
  private readonly targets: { target: ArtifactScopeTarget; path: string }[];
  private active = true;

  constructor(
    readonly rootDir: string,
    targets: readonly ArtifactScopeTarget[],
  ) {
    if (targets.length === 0 || targets.length > 64)
      throw new ArtifactError(
        "VEXT_OUTPUT_UNVERIFIED",
        "Invalid artifact draft scope count.",
      );
    this.targets = targets.map((target) => ({
      target: { ...target },
      path: artifactPath(rootDir, artifactRelativePath(rootDir, target.outDir)),
    }));
    for (let index = 0; index < this.targets.length; index++) {
      const current = this.targets[index]!;
      for (const previous of this.targets.slice(0, index)) {
        if (
          isPathInside(previous.path, current.path, true) ||
          isPathInside(current.path, previous.path, true)
        )
          throw new ArtifactError(
            "VEXT_OUTPUT_CONFLICT",
            "Artifact draft output scopes must not overlap.",
          );
      }
    }
  }

  private assertActive(): void {
    if (!this.active)
      throw new ArtifactError(
        "VEXT_OUTPUT_UNVERIFIED",
        "Artifact draft has closed.",
      );
  }

  owns(file: string): boolean {
    const absolute = path.resolve(file);
    return this.targets.some((target) => {
      const relative = path.relative(target.path, absolute);
      return (
        relative !== "" &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      );
    });
  }

  has(file: string): boolean {
    this.assertActive();
    return this.candidates.has(artifactFileKey(path.resolve(file)));
  }

  add(file: ArtifactCandidate, options: { replace?: boolean } = {}): void {
    this.assertActive();
    const absolute = artifactPath(
      this.rootDir,
      artifactRelativePath(this.rootDir, file.path),
    );
    if (!this.owns(absolute))
      throw new ArtifactError(
        "VEXT_OUTPUT_UNVERIFIED",
        `Artifact is outside the declared draft: ${file.path}`,
      );
    const key = artifactFileKey(absolute);
    const bytes = Buffer.from(file.contents);
    const previous = this.candidates.get(key);
    if (
      previous &&
      !options.replace &&
      !Buffer.from(previous.contents).equals(bytes)
    )
      throw new ArtifactError(
        "VEXT_OUTPUT_CONFLICT",
        `Two producers generated different bytes for ${file.path}`,
      );
    if (!previous && this.candidates.size >= MAX_ARTIFACT_FILES)
      throw new ArtifactError(
        "VEXT_OUTPUT_UNVERIFIED",
        "Too many draft artifacts.",
      );
    this.candidates.set(key, { ...file, path: absolute, contents: bytes });
  }

  read(file: string): Buffer {
    this.assertActive();
    const candidate = this.candidates.get(artifactFileKey(path.resolve(file)));
    if (!candidate)
      throw new ArtifactError(
        "VEXT_OUTPUT_UNVERIFIED",
        `Current artifact candidate is missing: ${file}`,
      );
    return Buffer.from(candidate.contents);
  }

  files(): string[] {
    this.assertActive();
    return [...this.candidates.values()].map((file) => file.path).sort();
  }

  updates(mode: "replace" | "merge" = "replace"): ArtifactScopeUpdate[] {
    this.assertActive();
    return this.targets.map(({ target, path: directory }) => ({
      ...target,
      mode,
      files: [...this.candidates.values()]
        .filter((file) => {
          const relative = path.relative(directory, file.path);
          return (
            relative !== "" &&
            relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
          );
        })
        .map((file) => ({ ...file, contents: Buffer.from(file.contents) })),
    }));
  }

  close(): void {
    this.active = false;
    this.candidates.clear();
  }
}
