/**
 * Bounded Bash-style brace expansion used by the glob wrappers.
 *
 * Mirrors the `braces` package in `expand: true, nodupes: true,
 * keepEscaping: true` mode for the grammar Vext accepts: comma lists, nested
 * groups, empty alternatives, numeric/alphabetic ranges with optional step and
 * zero padding. A group without a top-level comma or range stays literal.
 * Callers must run `assertGlobBudget()` first; the budget bounds the output.
 */

type Node = string | Node[][];

function findClose(pattern: string, open: number): number {
  let depth = 0;
  for (let index = open; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === "," && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

const RANGE = /^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/;

function expandRange(body: string): string[] | undefined {
  const match = RANGE.exec(body);
  if (!match) return undefined;
  const [, from, to, rawStep] = match as unknown as [
    string,
    string,
    string,
    string?,
  ];
  const numeric = /^-?\d+$/.test(from) && /^-?\d+$/.test(to);
  if (!numeric && (/^-?\d+$/.test(from) || /^-?\d+$/.test(to)))
    return undefined;
  const step = Math.abs(Number(rawStep ?? 1)) || 1;
  const start = numeric ? Number(from) : from.charCodeAt(0);
  const end = numeric ? Number(to) : to.charCodeAt(0);
  const pad = numeric
    ? Math.max(
        /^-?0\d/.test(from) ? from.replace("-", "").length : 0,
        /^-?0\d/.test(to) ? to.replace("-", "").length : 0,
      )
    : 0;
  const values: string[] = [];
  const direction = start <= end ? 1 : -1;
  for (
    let value = start;
    direction > 0 ? value <= end : value >= end;
    value += direction * step
  ) {
    if (!numeric) values.push(String.fromCharCode(value));
    else {
      const digits = String(Math.abs(value)).padStart(pad, "0");
      values.push(value < 0 ? `-${digits}` : digits);
    }
  }
  return values;
}

function parse(pattern: string): Node[] {
  const nodes: Node[] = [];
  let text = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === "\\") {
      text += pattern.slice(index, index + 2);
      index++;
      continue;
    }
    if (char === "{") {
      const close = findClose(pattern, index);
      if (close !== -1) {
        const body = pattern.slice(index + 1, close);
        const parts = splitTopLevel(body);
        const range = parts.length === 1 ? expandRange(body) : undefined;
        if (parts.length > 1 || range) {
          if (text) nodes.push(text);
          text = "";
          nodes.push(
            (range ?? parts).map((part) => (range ? [part] : parse(part))),
          );
          index = close;
          continue;
        }
        // Literal group such as `{a}`: keep braces, expand its body.
        const inner = expandBraces(body);
        if (inner.length > 1) {
          if (text) nodes.push(text);
          text = "";
          nodes.push(inner.map((value) => [`{${value}}`]));
        } else text += `{${inner[0] ?? body}}`;
        index = close;
        continue;
      }
    }
    text += char;
  }
  if (text) nodes.push(text);
  return nodes;
}

function expandNodes(nodes: Node[]): string[] {
  let results = [""];
  for (const node of nodes) {
    if (typeof node === "string") {
      results = results.map((prefix) => prefix + node);
      continue;
    }
    const alternatives = node.flatMap((alternative) =>
      expandNodes(alternative),
    );
    const next: string[] = [];
    for (const prefix of results)
      for (const alternative of alternatives) next.push(prefix + alternative);
    results = next;
  }
  return results;
}

/** Expand braces in one pattern, preserving order and dropping duplicates. */
export function expandBraces(pattern: string): string[] {
  return [...new Set(expandNodes(parse(pattern)))];
}
