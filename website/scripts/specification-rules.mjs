import { createHash } from "node:crypto";

const ruleHeading =
  /^###\s+(VEXT-(?:ARCH|HTTP|CONTRACT|DATA|SEC|RESOURCE|JOB|OPS)-\d{3})\s+\[(MUST(?: NOT)?|SHOULD|MAY)\]\s+(.+)$/;
const levels = {
  MUST: "must",
  "MUST NOT": "must-not",
  SHOULD: "should",
  MAY: "may",
};

// Keep line positions so parsing can ignore examples without deleting them
// from the body used for the content hash.
export function visibleMarkdownLines(content) {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  let frontmatter = lines[0] === "---";
  let fence = null;
  let comment = false;
  return lines.map((line, index) => {
    if (frontmatter) {
      if (index > 0 && /^---\s*$/.test(line)) frontmatter = false;
      return "";
    }
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (
        close &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length
      ) {
        fence = null;
      }
      return "";
    }
    let visible = "";
    let cursor = 0;
    while (cursor < line.length) {
      if (comment) {
        const end = line.indexOf("-->", cursor);
        if (end === -1) break;
        comment = false;
        cursor = end + 3;
      } else {
        const start = line.indexOf("<!--", cursor);
        if (start === -1) {
          visible += line.slice(cursor);
          break;
        }
        visible += line.slice(cursor, start);
        cursor = start + 4;
        comment = true;
      }
    }
    const open = visible.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = open[1];
      return "";
    }
    return visible;
  });
}

export function parseSpecificationRules(content, sourcePath = "<markdown>") {
  const original = content.replaceAll("\r\n", "\n").split("\n");
  const visible = visibleMarkdownLines(content);
  const anchors = new Map();
  for (const line of visible) {
    const outsideInlineCode = line.replace(/(`+).*?\1/g, "");
    for (const match of outsideInlineCode.matchAll(
      /\bid=["'](vext-[^"']+)["']/g,
    )) {
      anchors.set(match[1], (anchors.get(match[1]) ?? 0) + 1);
    }
  }
  const headings = [];
  const seen = new Set();
  for (let index = 0; index < visible.length; index += 1) {
    const line = visible[index];
    if (!/^ {0,3}#{1,6}\s+VEXT-/i.test(line)) continue;
    const match = line.match(ruleHeading);
    if (!match) {
      throw new Error(`Invalid Rule heading at ${sourcePath}:${index + 1}`);
    }
    const id = match[1];
    const anchor = id.toLowerCase();
    let anchorIndex = index - 1;
    while (anchorIndex >= 0 && !original[anchorIndex].trim()) anchorIndex -= 1;
    if (
      visible[anchorIndex]?.trim() !== `<a id="${anchor}"></a>` ||
      anchors.get(anchor) !== 1
    ) {
      throw new Error(
        `Rule ${id} requires one adjacent anchor in ${sourcePath}`,
      );
    }
    if (seen.has(id)) throw new Error(`Duplicate Rule ${id} in ${sourcePath}`);
    seen.add(id);
    headings.push({ index, anchorIndex, id, anchor, match });
  }
  for (const anchor of anchors.keys()) {
    if (!headings.some((heading) => heading.anchor === anchor)) {
      throw new Error(`Orphan Rule anchor ${anchor} in ${sourcePath}`);
    }
  }
  return headings.map(({ index, id, anchor, match }) => {
    let end = index + 1;
    while (end < visible.length && !/^ {0,3}#{1,3}\s/.test(visible[end])) {
      end += 1;
    }
    const next = headings.find((heading) => heading.index === end);
    if (next) end = next.anchorIndex;
    const body = original
      .slice(index, end)
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
    return {
      id,
      level: levels[match[2]],
      title: match[3],
      anchor,
      contentHash: createHash("sha256").update(body).digest("hex"),
    };
  });
}
