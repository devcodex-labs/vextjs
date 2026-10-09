import micromatch from "micromatch";
import { assertGlobBudget } from "./glob-budget.js";

function validate(args: unknown[], index = 1): void {
  assertGlobBudget(args[index] as string | string[]);
  const ignore = (args[index + 1] as { ignore?: string | string[] } | undefined)
    ?.ignore;
  if (ignore) assertGlobBudget(ignore, "glob ignore");
}
const firstArgument = new Set([
  "matcher",
  "hasBraces",
  "makeRe",
  "parse",
  "scan",
  "braces",
  "braceExpand",
  "capture",
]);
export default new Proxy(micromatch, {
  apply(target, receiver, args) {
    validate(args);
    return Reflect.apply(target, receiver, args);
  },
  get(target, key, receiver) {
    const value = Reflect.get(target, key, receiver);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => {
      validate(args, firstArgument.has(String(key)) ? 0 : 1);
      return Reflect.apply(value, target, args);
    };
  },
}) as typeof micromatch;
