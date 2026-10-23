import { glob as tinyGlob, globSync as tinyGlobSync } from "tinyglobby";
import { assertGlobBudget } from "./glob-budget.js";
import {
  escapePath,
  expandPatterns,
  generateTasks,
  isDynamicPattern,
  type GlobTask,
  type GlobTaskOptions,
} from "./glob-tasks.js";

/** fast-glob@3 option subset used by the framework. */
export interface SafeGlobOptions {
  cwd?: string;
  absolute?: boolean;
  onlyFiles?: boolean;
  onlyDirectories?: boolean;
  dot?: boolean;
  deep?: number;
  followSymbolicLinks?: boolean;
  ignore?: string[];
  caseSensitiveMatch?: boolean;
  braceExpansion?: boolean;
  extglob?: boolean;
}

type Patterns = string | string[];

function validate(patterns: unknown, options?: { ignore?: unknown }): void {
  assertGlobBudget(patterns as string | string[]);
  if (options?.ignore)
    assertGlobBudget(options.ignore as string[], "glob ignore");
}

function assertPatterns(patterns: unknown): asserts patterns is Patterns {
  const list = typeof patterns === "string" ? [patterns] : patterns;
  if (
    !Array.isArray(list) ||
    !list.every((item) => typeof item === "string" && item !== "")
  ) {
    throw new TypeError(
      "Patterns must be a string (non empty) or an array of strings",
    );
  }
}

/**
 * Translate fast-glob options. Braces are expanded here (fast-glob semantics,
 * including ranges) so picomatch only sees brace-free patterns, and directory
 * auto-expansion is disabled to keep fast-glob's literal matching.
 */
function translate(patterns: Patterns, options: SafeGlobOptions = {}) {
  const expand = (list: string | string[]) =>
    expandPatterns(typeof list === "string" ? [list] : list, options);
  return {
    patterns: expand(patterns),
    options: {
      cwd: options.cwd,
      absolute: options.absolute ?? false,
      onlyFiles: options.onlyDirectories ? false : (options.onlyFiles ?? true),
      onlyDirectories: options.onlyDirectories ?? false,
      dot: options.dot ?? false,
      deep: options.deep,
      followSymbolicLinks: options.followSymbolicLinks ?? true,
      ignore: options.ignore ? expand(options.ignore) : [],
      caseSensitiveMatch: options.caseSensitiveMatch ?? true,
      extglob: options.extglob ?? true,
      braceExpansion: false,
      expandDirectories: false,
    },
  };
}

function stripDirectorySlash(files: string[], options: SafeGlobOptions) {
  // fast-glob reports directories without a trailing slash.
  return options.onlyFiles === false || options.onlyDirectories
    ? files.map((file) => (file.length > 1 ? file.replace(/\/$/, "") : file))
    : files;
}

type Runner = (
  patterns: string[],
  options: ReturnType<typeof translate>["options"],
) => string[] | Promise<string[]>;

/**
 * fast-glob keeps a leading `./` in relative results produced by `./`-based
 * patterns unless another pattern already roots the walk at `.`.
 */
function plan(patterns: Patterns, options: SafeGlobOptions) {
  validate(patterns, options);
  assertPatterns(patterns);
  const input = translate(patterns, options);
  const positive = input.patterns.filter((pattern) => !pattern.startsWith("!"));
  const dotted = positive.filter(
    (pattern) => pattern.startsWith("./") && !pattern.startsWith("./.."),
  );
  const rootTask = generateTasks(patterns, options).some(
    (task) => task.base === ".",
  );
  if (options.absolute || dotted.length === 0 || rootTask)
    return [{ prefix: "", patterns: input.patterns, options: input.options }];
  const negatives = input.patterns.filter((pattern) => pattern.startsWith("!"));
  const plain = positive.filter((pattern) => !dotted.includes(pattern));
  return [
    ...(plain.length > 0
      ? [
          {
            prefix: "",
            patterns: [...plain, ...negatives],
            options: input.options,
          },
        ]
      : []),
    {
      prefix: "./",
      patterns: [...dotted.map((pattern) => pattern.slice(2)), ...negatives],
      options: input.options,
    },
  ];
}

function finish(
  results: Array<{ prefix: string; files: string[] }>,
  options: SafeGlobOptions,
): string[] {
  const seen = new Set<string>();
  for (const { prefix, files } of results)
    for (const file of stripDirectorySlash(files, options))
      seen.add(prefix + file);
  return [...seen];
}

function glob(
  patterns: Patterns,
  options: SafeGlobOptions = {},
): Promise<string[]> {
  // Validate synchronously so budget errors throw before any Promise exists.
  const steps = plan(patterns, options);
  const run: Runner = tinyGlob;
  return Promise.all(
    steps.map(async (step) => ({
      prefix: step.prefix,
      files: await run(step.patterns, step.options),
    })),
  ).then((results) => finish(results, options));
}

function sync(patterns: Patterns, options: SafeGlobOptions = {}): string[] {
  const steps = plan(patterns, options);
  return finish(
    steps.map((step) => ({
      prefix: step.prefix,
      files: tinyGlobSync(step.patterns, step.options),
    })),
    options,
  );
}

/** Keep the fast-glob API subset used by Vext while guarding every parser entry. */
const fg = Object.assign(glob, {
  glob,
  async: glob,
  sync,
  globSync: sync,
  escapePath,
  generateTasks(patterns: Patterns, options: GlobTaskOptions = {}): GlobTask[] {
    validate(patterns, options);
    assertPatterns(patterns);
    return generateTasks(patterns, options);
  },
  isDynamicPattern(pattern: string, options: GlobTaskOptions = {}): boolean {
    validate(pattern, options);
    assertPatterns(pattern);
    return isDynamicPattern(pattern, options);
  },
});

export type { GlobTask };
export default fg;
