/** Validate before invoking recursive glob parsers, including malformed patterns. */
export function assertGlobBudget(
  patterns: string | readonly string[],
  label = "glob pattern",
): void {
  const list = typeof patterns === "string" ? [patterns] : patterns;
  if (list.length > 1024)
    throw new Error(`[vextjs] ${label} exceeds 1024 patterns.`);
  for (const pattern of list) {
    if (typeof pattern !== "string" || pattern.length > 4096) {
      throw new Error(
        `[vextjs] ${label} must be a string of at most 4096 characters.`,
      );
    }
    const groups: Array<{
      start: number;
      alternatives: number;
      product: number;
    }> = [];
    let parentheses = 0;
    let expansion = 1;
    for (let index = 0; index < pattern.length; index++) {
      const char = pattern[index];
      if (char === "\\") {
        index++;
        continue;
      }
      if (char === "(") parentheses++;
      if (char === ")") parentheses = Math.max(0, parentheses - 1);
      if (char === "{")
        groups.push({ start: index + 1, alternatives: 1, product: 1 });
      if (groups.length + parentheses > 100)
        throw new Error(`[vextjs] ${label} exceeds nesting depth 100.`);
      const group = groups.at(-1);
      if (char === "," && group) group.alternatives++;
      if (char === "}" && group) {
        groups.pop();
        const body = pattern.slice(group.start, index);
        const range =
          /^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/.exec(body);
        let count = group.alternatives * group.product;
        if (range) {
          const start = /^-?\d+$/.test(range[1]!)
            ? Number(range[1])
            : range[1]!.charCodeAt(0);
          const end = /^-?\d+$/.test(range[2]!)
            ? Number(range[2])
            : range[2]!.charCodeAt(0);
          const step = range[3] === undefined ? 1 : Math.abs(Number(range[3]));
          count =
            step > 0 ? Math.floor(Math.abs(end - start) / step) + 1 : Infinity;
        }
        const parent = groups.at(-1);
        if (parent) parent.product *= count;
        else expansion *= count;
        if (
          !Number.isFinite(count) ||
          count > 4096 ||
          expansion > 4096 ||
          (parent?.product ?? 1) > 4096
        ) {
          throw new Error(
            `[vextjs] ${label} exceeds brace expansion budget 4096.`,
          );
        }
      }
    }
  }
}
