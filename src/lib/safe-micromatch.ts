import picomatch from "picomatch";
import { assertGlobBudget } from "./glob-budget.js";

/** micromatch@4 option subset used by the framework (passed to picomatch). */
export type SafeMatchOptions = picomatch.PicomatchOptions;
type Patterns = string | readonly string[];

function validate(patterns: unknown, options?: { ignore?: unknown }): void {
  assertGlobBudget(patterns as string | string[]);
  if (options?.ignore)
    assertGlobBudget(options.ignore as string | string[], "glob ignore");
}

/** micromatch@4 list matching, including negation-only pattern lists. */
function match(
  list: string | readonly string[],
  patterns: Patterns,
  options?: SafeMatchOptions,
): string[] {
  validate(patterns, options);
  const patternList = ([] as string[]).concat(patterns as string | string[]);
  const items = ([] as string[]).concat(list as string | string[]);
  const omit = new Set<string>();
  const keep = new Set<string>();
  const outputs = new Set<string>();
  let negatives = 0;
  const onResult = (state: { output: string }) => {
    outputs.add(state.output);
    options?.onResult?.(state as never);
  };
  for (const pattern of patternList) {
    const isMatch = picomatch(String(pattern), { ...options, onResult }, true);
    const negated = isMatch.state.negated || isMatch.state.negatedExtglob;
    if (negated) negatives++;
    for (const item of items) {
      const matched = isMatch(item, true) as unknown as {
        isMatch: boolean;
        output: string;
      };
      const ok = negated ? !matched.isMatch : matched.isMatch;
      if (!ok) continue;
      if (negated) omit.add(matched.output);
      else {
        omit.delete(matched.output);
        keep.add(matched.output);
      }
    }
  }
  const result = negatives === patternList.length ? [...outputs] : [...keep];
  return result.filter((item) => !omit.has(item));
}

const micromatch = Object.assign(match, {
  isMatch(value: string, patterns: Patterns, options?: SafeMatchOptions) {
    validate(patterns, options);
    return picomatch(patterns as string | string[], options)(value);
  },
  matcher(pattern: Patterns, options?: SafeMatchOptions) {
    validate(pattern, options);
    return picomatch(pattern as string | string[], options);
  },
  makeRe(pattern: string, options?: SafeMatchOptions) {
    validate(pattern, options);
    return picomatch.makeRe(pattern, options);
  },
  parse(pattern: string, options?: SafeMatchOptions) {
    validate(pattern, options);
    return picomatch.parse(pattern, options);
  },
  scan(pattern: string, options?: Parameters<typeof picomatch.scan>[1]) {
    validate(pattern);
    return picomatch.scan(pattern, options);
  },
});

export default micromatch;
