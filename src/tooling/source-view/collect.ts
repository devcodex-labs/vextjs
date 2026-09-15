import fs from "node:fs";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import {
  ProjectFileReadError,
  readProjectFile,
} from "../../lib/project/read-project-file.js";
import {
  assertSourceBudget,
  copySourceRoots,
  normalizeSourceRef,
  requireSourceLabel,
  resolveSourceLimits,
  sourceKey,
} from "./policy.js";
import {
  SourceViewError,
  type SourceFileRef,
  type SourceInput,
  type RootRef,
  type SourceView,
  type SourceViewOptions,
} from "./types.js";
import { createSourceView } from "./view.js";

function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SourceViewError(
      "VEXT_SOURCE_CANCELLED",
      "Source collection was cancelled.",
    );
  }
}

/** 清单由各角色的发现器提供；此处不递归 glob，也不加载业务模块。 */
export async function collectSourceView(
  options: SourceViewOptions & {
    readonly files: Iterable<SourceFileRef>;
    readonly signal?: AbortSignal;
    /** 在封存前复读已选内容以发现采集期间修改；仍不承诺跨文件原子快照。 */
    readonly verifyUnchanged?: boolean;
    /** 仅扩展声明的读取清单；新增项仍通过同一根、去重、字节与数量校验。 */
    readonly dependencies?: (
      input: SourceInput,
      root: RootRef,
    ) => Iterable<SourceFileRef>;
  },
): Promise<SourceView> {
  const signal = options.signal;
  checkCancellation(signal);
  const declaredRoots = copySourceRoots(options.roots);
  const limits = resolveSourceLimits(options.limits);
  const rolePolicyVersion = requireSourceLabel(
    options.rolePolicyVersion,
    "role policy version",
  );
  const files = new Map<string, SourceFileRef>();
  for (const input of options.files) {
    checkCancellation(signal);
    const ref = normalizeSourceRef(input, declaredRoots);
    const key = sourceKey(ref.rootId, ref.path);
    if (files.has(key)) {
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        "Duplicate source inventory entry.",
      );
    }
    assertSourceBudget(files.size + 1, 0, limits);
    files.set(key, ref);
  }

  try {
    const identities = new Set<string>();
    const roots = [...declaredRoots.values()].map((root) => {
      const realPath = fs.realpathSync.native(root.realPath);
      const stat = fs.lstatSync(realPath, { bigint: true });
      const identity = stat.dev + ":" + stat.ino;
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        identities.has(identity)
      ) {
        throw new SourceViewError(
          "VEXT_SOURCE_UNVERIFIED",
          "Source roots must have distinct, verifiable directory identities.",
        );
      }
      identities.add(identity);
      return { root: { ...root, realPath }, stat };
    });
    const rootsById = new Map(roots.map((item) => [item.root.id, item.root]));
    const inputs: SourceInput[] = [];
    let totalBytes = 0;
    for (const ref of files.values()) {
      checkCancellation(signal);
      const root = rootsById.get(ref.rootId)!;
      const remaining = Math.min(
        limits.maxFileBytes,
        limits.maxTotalBytes - totalBytes,
      );
      const bytes = readProjectFile(root.realPath, ref.path, remaining);
      if (bytes === null) {
        throw new SourceViewError(
          "VEXT_SOURCE_CHANGED",
          "Discovered source disappeared: " + ref.rootId + "/" + ref.path + ".",
        );
      }
      totalBytes += bytes.length;
      assertSourceBudget(inputs.length + 1, totalBytes, limits);
      inputs.push({ ...ref, bytes });
      for (const dependency of options.dependencies?.(
        { ...ref, bytes: Buffer.from(bytes) },
        root,
      ) ?? []) {
        const next = normalizeSourceRef(dependency, declaredRoots);
        const key = sourceKey(next.rootId, next.path);
        if (files.has(key)) continue;
        assertSourceBudget(files.size + 1, totalBytes, limits);
        files.set(key, next);
      }
      if (inputs.length % 16 === 0) await yieldToEventLoop();
    }
    checkCancellation(signal);
    if (options.verifyUnchanged) {
      for (const [index, input] of inputs.entries()) {
        checkCancellation(signal);
        const root = rootsById.get(input.rootId)!;
        const latest = readProjectFile(
          root.realPath,
          input.path,
          limits.maxFileBytes,
        );
        if (latest === null || !latest.equals(Buffer.from(input.bytes))) {
          throw new SourceViewError(
            "VEXT_SOURCE_CHANGED",
            `Source changed during collection: ${input.rootId}/${input.path}.`,
          );
        }
        if (index % 16 === 0) await yieldToEventLoop();
      }
    }
    for (const { root, stat } of roots) {
      const after = fs.lstatSync(root.realPath, { bigint: true });
      if (
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        after.dev !== stat.dev ||
        after.ino !== stat.ino ||
        fs.realpathSync.native(root.realPath) !== root.realPath
      ) {
        throw new SourceViewError(
          "VEXT_SOURCE_CHANGED",
          "Source root changed during collection: " + root.id + ".",
        );
      }
    }
    return createSourceView({
      roots: roots.map((item) => item.root),
      files: inputs,
      rolePolicyVersion,
      limits,
    });
  } catch (cause) {
    if (cause instanceof SourceViewError) throw cause;
    const code =
      cause instanceof ProjectFileReadError
        ? cause.kind === "limit"
          ? "VEXT_SOURCE_LIMIT"
          : cause.kind === "changed"
            ? "VEXT_SOURCE_CHANGED"
            : "VEXT_SOURCE_UNVERIFIED"
        : "VEXT_SOURCE_UNVERIFIED";
    throw new SourceViewError(
      code,
      "Source collection could not verify the declared files: " +
        (cause instanceof Error ? cause.message : String(cause)),
      { cause },
    );
  }
}
