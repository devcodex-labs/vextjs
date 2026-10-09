import fg from "fast-glob";
import { assertGlobBudget } from "./glob-budget.js";

const guarded = new Set([
  "glob",
  "async",
  "sync",
  "globSync",
  "stream",
  "globStream",
  "generateTasks",
  "isDynamicPattern",
]);
function validate(args: unknown[]): void {
  assertGlobBudget(args[0] as string | string[]);
  const ignore = (args[1] as { ignore?: string[] } | undefined)?.ignore;
  if (ignore) assertGlobBudget(ignore, "glob ignore");
}

/** Keep fast-glob's API while guarding every parsing entry used by the framework. */
export default new Proxy(fg, {
  apply(target, receiver, args) {
    validate(args);
    return Reflect.apply(target, receiver, args);
  },
  get(target, key, receiver) {
    const value = Reflect.get(target, key, receiver);
    if (
      typeof key !== "string" ||
      !guarded.has(key) ||
      typeof value !== "function"
    )
      return value;
    return (...args: unknown[]) => {
      validate(args);
      return Reflect.apply(value, target, args);
    };
  },
}) as typeof fg;
