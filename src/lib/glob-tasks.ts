/**
 * fast-glob@3 compatible pattern utilities (task generation, dynamic-pattern
 * detection, path escaping) implemented on picomatch.
 */
import path from "node:path";
import picomatch from "picomatch";
import { expandBraces } from "./glob-braces.js";

export interface GlobTask {
  base: string;
  dynamic: boolean;
  patterns: string[];
  positive: string[];
  negative: string[];
}

export interface GlobTaskOptions {
  ignore?: string | readonly string[];
  dot?: boolean;
  caseSensitiveMatch?: boolean;
  extglob?: boolean;
  braceExpansion?: boolean;
  baseNameMatch?: boolean;
}

const ESCAPE_SYMBOL = "\\";
const COMMON_GLOB_SYMBOLS_RE = /[*?]|^!/;
const REGEX_CHARACTER_CLASS_SYMBOLS_RE = /\[[^[]*]/;
const REGEX_GROUP_SYMBOLS_RE = /(?:^|[^!*+?@])\([^(]*\|[^|]*\)/;
const GLOB_EXTENSION_SYMBOLS_RE = /[!*+?@]\([^(]*\)/;
const BRACE_EXPANSION_SEPARATORS_RE = /,|\.\./;
const DOUBLE_SLASH_RE = /(?!^)\/{2,}/g;
const POSIX_UNESCAPED_GLOB_SYMBOLS_RE =
  /(\\?)([()*?[\]{|}]|^!|[!+@](?=\()|\\(?![!()*+?@[\]{|}]))/g;
const WINDOWS_UNESCAPED_GLOB_SYMBOLS_RE = /(\\?)([()[\]{}]|^!|[!+@](?=\())/g;

function hasBraceExpansion(pattern: string): boolean {
  const open = pattern.indexOf("{");
  if (open === -1) return false;
  const close = pattern.indexOf("}", open + 1);
  if (close === -1) return false;
  return BRACE_EXPANSION_SEPARATORS_RE.test(pattern.slice(open, close));
}

export function isDynamicPattern(
  pattern: string,
  options: GlobTaskOptions = {},
): boolean {
  if (pattern === "") return false;
  if (options.caseSensitiveMatch === false || pattern.includes(ESCAPE_SYMBOL))
    return true;
  if (
    COMMON_GLOB_SYMBOLS_RE.test(pattern) ||
    REGEX_CHARACTER_CLASS_SYMBOLS_RE.test(pattern) ||
    REGEX_GROUP_SYMBOLS_RE.test(pattern)
  )
    return true;
  if (options.extglob !== false && GLOB_EXTENSION_SYMBOLS_RE.test(pattern))
    return true;
  return options.braceExpansion !== false && hasBraceExpansion(pattern);
}

export function escapePath(pattern: string): string {
  return process.platform === "win32"
    ? pattern.replace(WINDOWS_UNESCAPED_GLOB_SYMBOLS_RE, "\\$2")
    : pattern.replace(POSIX_UNESCAPED_GLOB_SYMBOLS_RE, "\\$2");
}

const isNegative = (pattern: string) =>
  pattern.startsWith("!") && pattern[1] !== "(";
const toPositive = (pattern: string) =>
  isNegative(pattern) ? pattern.slice(1) : pattern;

function isGlob(value: string): boolean {
  return picomatch.scan(value).isGlob;
}

/** glob-parent@5 semantics without flipping backslashes. */
function globParent(input: string): string {
  let value = input;
  if (/[{[].*[}\]]$/.test(value)) value += "/";
  value += "a";
  do value = path.posix.dirname(value);
  while (isGlob(value) || /(^|[^\\])([{[]|\([^)]+$)/.test(value));
  return value.replace(/\\([!*?|[\](){}])/g, "$1");
}

export function expandPatterns(
  patterns: readonly string[],
  options: GlobTaskOptions = {},
): string[] {
  let result = [...patterns];
  if (options.braceExpansion !== false)
    result = result.flatMap((pattern) =>
      expandBraces(pattern)
        .sort((left, right) => left.length - right.length)
        .filter((value) => value !== ""),
    );
  if (options.baseNameMatch)
    result = result.map((pattern) =>
      pattern.includes("/") ? pattern : `**/${pattern}`,
    );
  return result.map((pattern) => pattern.replace(DOUBLE_SLASH_RE, "/"));
}

function toTask(
  base: string,
  positive: string[],
  negative: string[],
  dynamic: boolean,
): GlobTask {
  return {
    dynamic,
    positive,
    negative,
    base,
    patterns: [...positive, ...negative.map((pattern) => `!${pattern}`)],
  };
}

function groupTasks(
  positive: string[],
  negative: string[],
  dynamic: boolean,
): GlobTask[] {
  const group = (list: string[]) => {
    const groups = new Map<string, string[]>();
    for (const pattern of list) {
      const base = globParent(pattern);
      groups.set(base, [...(groups.get(base) ?? []), pattern]);
    }
    return groups;
  };
  const outside = positive.filter(
    (pattern) => pattern.startsWith("..") || pattern.startsWith("./.."),
  );
  const inside = positive.filter((pattern) => !outside.includes(pattern));
  const tasks = [...group(outside)].map(([base, list]) =>
    toTask(base, list, negative, dynamic),
  );
  const insideGroups = group(inside);
  if (insideGroups.has(".")) tasks.push(toTask(".", inside, negative, dynamic));
  else
    for (const [base, list] of insideGroups)
      tasks.push(toTask(base, list, negative, dynamic));
  return tasks;
}

export function generateTasks(
  input: string | readonly string[],
  options: GlobTaskOptions = {},
): GlobTask[] {
  const patterns = expandPatterns(
    typeof input === "string" ? [input] : input,
    options,
  );
  const ignoreInput = options.ignore ?? [];
  const ignore = expandPatterns(
    typeof ignoreInput === "string" ? [ignoreInput] : ignoreInput,
    options,
  );
  const positive = patterns.filter((pattern) => !isNegative(pattern));
  const negative = [...patterns.filter(isNegative), ...ignore].map(toPositive);
  return [
    ...groupTasks(
      positive.filter((pattern) => !isDynamicPattern(pattern, options)),
      negative,
      false,
    ),
    ...groupTasks(
      positive.filter((pattern) => isDynamicPattern(pattern, options)),
      negative,
      true,
    ),
  ];
}
