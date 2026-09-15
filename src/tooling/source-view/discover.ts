import fs from "node:fs";
import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import micromatch from "micromatch";
import { assertRealPathInside } from "../../lib/path-boundary.js";
import { resolveSourceLimits } from "./policy.js";
import { SourceViewError, type SourceLimits } from "./types.js";

/** CLI、构建和类型生成共用宿主显式预算；纯SourceView本身不读取环境。 */
export function projectSourceLimits(
  input: Partial<SourceLimits> = {},
): Readonly<SourceLimits> {
  const environment: Partial<SourceLimits> = {};
  const names = {
    maxFiles: "VEXT_SOURCE_MAX_FILES",
    maxFileBytes: "VEXT_SOURCE_MAX_FILE_BYTES",
    maxTotalBytes: "VEXT_SOURCE_MAX_TOTAL_BYTES",
    maxScanEntries: "VEXT_SOURCE_MAX_SCAN_ENTRIES",
  } as const;
  for (const [key, name] of Object.entries(names)) {
    const value = process.env[name];
    if (value === undefined || input[key as keyof SourceLimits] !== undefined)
      continue;
    if (!/^(?:0|[1-9]\d*)$/u.test(value))
      throw new SourceViewError(
        "VEXT_SOURCE_LIMIT",
        `Invalid source budget ${name}: expected a non-negative integer.`,
      );
    Object.assign(environment, { [key]: Number(value) });
  }
  return resolveSourceLimits({ ...environment, ...input });
}

/** 各消费者显式选择文件类型；共享发现器只负责预算、取消和真实路径边界。 */
export async function* discoverSourceFiles(
  root: string,
  directory: string,
  patterns: string[],
  ignore: string[],
  budget: { entries: number; limit: number },
  cancelled: () => void,
  acceptFile: (name: string) => boolean = () => true,
  acceptDirectory: (relative: string) => boolean = () => true,
  observeDirectory?: (
    absolute: string,
    real: string,
    stat: fs.BigIntStats,
  ) => void,
): AsyncGenerator<string> {
  const pending = [{ relative: "", ancestors: new Set<string>() }];
  while (pending.length) {
    cancelled();
    const current = pending.pop()!;
    const absolute = path.join(root, directory, current.relative);
    const real = assertRealPathInside(
      root,
      absolute,
      "source directory",
      current.relative === "" &&
        path.resolve(root, directory) === path.resolve(root),
    );
    const identity = process.platform === "win32" ? real.toLowerCase() : real;
    if (current.ancestors.has(identity))
      throw new SourceViewError(
        "VEXT_SOURCE_UNVERIFIED",
        `Source directory cycle: ${absolute}. Analysis is incomplete.`,
      );
    const ancestors = new Set([...current.ancestors, identity]);
    const before = fs.statSync(absolute, { bigint: true });
    observeDirectory?.(absolute, real, before);
    // opendir逐条消费；超限/取消/失败时for-await负责关闭当前目录句柄。
    const handle = await fs.promises.opendir(absolute);
    for await (const entry of handle) {
      cancelled();
      if (++budget.entries > budget.limit)
        throw new SourceViewError(
          "VEXT_SOURCE_LIMIT",
          `Source discovery is incomplete at ${absolute}: exceeds ${budget.limit} entries. Adjust VEXT_SOURCE_MAX_SCAN_ENTRIES.`,
        );
      if (budget.entries % 16 === 0) {
        await yieldToEventLoop();
        cancelled();
      }
      const relative = path.posix.join(current.relative, entry.name);
      if (
        micromatch.isMatch(relative, ignore, { dot: true }) ||
        micromatch.isMatch(`${relative}/`, ignore, { dot: true })
      )
        continue;
      const target = path.join(absolute, entry.name);
      if (
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        !acceptDirectory(relative)
      )
        continue;
      let isDirectory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        assertRealPathInside(root, target, "linked source");
        isDirectory = fs.statSync(target).isDirectory();
        if (!isDirectory)
          throw new SourceViewError(
            "VEXT_SOURCE_UNVERIFIED",
            `Linked source file is unsupported: ${target}. Analysis is incomplete.`,
          );
      }
      if (isDirectory) pending.push({ relative, ancestors });
      else if (
        entry.isFile() &&
        acceptFile(entry.name) &&
        micromatch.isMatch(relative, patterns)
      )
        yield relative;
    }
    const after = fs.statSync(absolute, { bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      (observeDirectory !== undefined &&
        (after.mtimeNs !== before.mtimeNs ||
          after.ctimeNs !== before.ctimeNs)) ||
      fs.realpathSync.native(absolute) !== real
    )
      throw new SourceViewError(
        "VEXT_SOURCE_CHANGED",
        `Source directory changed: ${absolute}.`,
      );
  }
}
