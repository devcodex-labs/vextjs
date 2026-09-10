import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import {
  assertSourceBudget,
  copySourceRoots,
  normalizeSourceRef,
  requireSourceLabel,
  resolveSourceLimits,
  sourceByteLength,
  sourceKey,
} from "./policy.js";
import {
  SourceViewError,
  type RootRef,
  type SourceChange,
  type SourceInput,
  type SourceLimits,
  type SourceRecord,
  type SourceView,
  type SourceViewOptions,
} from "./types.js";

interface SealedEntry {
  readonly record: SourceRecord;
  readonly text: string;
}

interface ViewState {
  readonly roots: ReadonlyMap<string, RootRef>;
  readonly entries: ReadonlyMap<string, SealedEntry>;
  readonly rolePolicyVersion: string;
  readonly limits: Readonly<SourceLimits>;
  readonly totalBytes: number;
}

// 状态不作为 View 属性暴露；调用方无法取得可变 Map 或源 Buffer。
const states = new WeakMap<SourceView, ViewState>();

function newlineKind(text: string): SourceRecord["newline"] {
  let lf = false;
  let crlf = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\r") {
      if (text[index + 1] !== "\n") return "mixed";
      crlf = true;
      index++;
    } else if (text[index] === "\n") lf = true;
  }
  return lf && crlf ? "mixed" : crlf ? "crlf" : "lf";
}

function createEntry(input: SourceInput, limits: SourceLimits): SealedEntry {
  sourceByteLength(input.bytes, limits);
  const bytes = Buffer.from(input.bytes);
  let text: string;
  try {
    // ignoreBOM=true 表示保留 BOM；源码偏移与原文一致，绝不替换非法 UTF-8。
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (cause) {
    throw new SourceViewError(
      "VEXT_SOURCE_UNVERIFIED",
      "Source is not valid UTF-8: " + input.rootId + "/" + input.path + ".",
      { cause },
    );
  }
  return Object.freeze({
    text,
    record: Object.freeze({
      rootId: input.rootId,
      path: input.path,
      role: input.role,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
      encoding: "utf8" as const,
      bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      newline: newlineKind(text),
    }),
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function seal(state: ViewState): SourceView {
  const ordered = [...state.entries.entries()].sort(([a], [b]) =>
    compareText(a, b),
  );
  const records = Object.freeze(ordered.map(([, entry]) => entry.record));
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        rolePolicyVersion: state.rolePolicyVersion,
        roots: [...state.roots.values()]
          .sort((a, b) => compareText(a.id, b.id))
          .map((root) => [root.id, root.kind]),
        files: records.map((record) => [
          record.rootId,
          record.path,
          record.role,
          record.sha256,
        ]),
      }),
    )
    .digest("hex");
  const view: SourceView = Object.freeze({
    revision,
    list(filter?: { rootId?: string; roles?: readonly string[] }) {
      if (!filter) return records;
      const roles =
        filter.roles === undefined ? undefined : new Set(filter.roles);
      return Object.freeze(
        records.filter(
          (record) =>
            (filter.rootId === undefined || record.rootId === filter.rootId) &&
            (roles === undefined || roles.has(record.role)),
        ),
      );
    },
    read(rootId: string, relativePath: string) {
      return state.entries.get(sourceKey(rootId, relativePath))?.text;
    },
    record(rootId: string, relativePath: string) {
      return state.entries.get(sourceKey(rootId, relativePath))?.record;
    },
  });
  states.set(view, state);
  return view;
}

/** 纯字节封存；目录发现、用户代码求值和文件读取都不属于此函数。 */
export function createSourceView(
  options: SourceViewOptions & { readonly files: Iterable<SourceInput> },
): SourceView {
  const roots = copySourceRoots(options.roots);
  const limits = resolveSourceLimits(options.limits);
  const rolePolicyVersion = requireSourceLabel(
    options.rolePolicyVersion,
    "role policy version",
  );
  const entries = new Map<string, SealedEntry>();
  let totalBytes = 0;
  for (const input of options.files) {
    const ref = normalizeSourceRef(input, roots);
    const key = sourceKey(ref.rootId, ref.path);
    if (entries.has(key)) {
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        "Duplicate source file: " + ref.rootId + "/" + ref.path + ".",
      );
    }
    totalBytes += sourceByteLength(input.bytes, limits);
    assertSourceBudget(entries.size + 1, totalBytes, limits);
    entries.set(key, createEntry({ ...ref, bytes: input.bytes }, limits));
  }
  return seal({ roots, limits, rolePolicyVersion, entries, totalBytes });
}

/** 删除在新 Map 中直接物化；候选没有 base reader，更没有 live-disk 回退。 */
export function overlaySourceView(
  base: SourceView,
  changes: readonly SourceChange[],
): SourceView {
  const state = states.get(base);
  if (!state) {
    throw new SourceViewError(
      "VEXT_SOURCE_UNVERIFIED",
      "Overlay requires a sealed source view.",
    );
  }
  if (changes.length === 0) return base;
  if (changes.length > state.limits.maxFiles * 2) {
    throw new SourceViewError(
      "VEXT_SOURCE_LIMIT",
      "Source change count exceeds its budget.",
    );
  }
  const operations = new Map<string, { input?: SourceInput }>();
  let count = state.entries.size;
  let totalBytes = state.totalBytes;
  for (const change of changes) {
    const key = sourceKey(change.rootId, change.path);
    if (operations.has(key)) {
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        "Duplicate source change target.",
      );
    }
    const previous = state.entries.get(key);
    if (change.kind === "create") {
      if (previous) {
        throw new SourceViewError(
          "VEXT_SOURCE_CHANGED",
          "Source create target already exists: " + change.path + ".",
        );
      }
      count++;
    } else {
      if (!previous || previous.record.sha256 !== change.expectedSha256) {
        throw new SourceViewError(
          "VEXT_SOURCE_CHANGED",
          "Source change precondition differs: " + change.path + ".",
        );
      }
      totalBytes -= previous.record.byteLength;
      if (change.kind === "delete") count--;
    }
    if (change.kind === "delete") {
      operations.set(key, {});
      continue;
    }
    const ref = normalizeSourceRef(
      {
        rootId: change.rootId,
        path: change.path,
        role: change.role ?? previous!.record.role,
      },
      state.roots,
    );
    totalBytes += sourceByteLength(change.bytes, state.limits);
    operations.set(key, { input: { ...ref, bytes: change.bytes } });
  }
  // 先验最终预算；允许等量删除/新增，不让变化顺序或解码前分配影响结论。
  assertSourceBudget(count, totalBytes, state.limits);
  const entries = new Map(state.entries);
  for (const [key, operation] of operations) {
    if (operation.input)
      entries.set(key, createEntry(operation.input, state.limits));
    else entries.delete(key);
  }
  return seal({ ...state, entries, totalBytes });
}
