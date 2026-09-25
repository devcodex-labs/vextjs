import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { parseSpecificationRules } from "../website/scripts/specification-rules.mjs";

const heading = "### VEXT-HTTP-001 [MUST] Read `req.valid()`";
const anchor = '<a id="vext-http-001"></a>';
const body = `${heading}\n\nBody.\n\n\`\`\`ts\nconst value = 1;\n\`\`\``;
const first = `${anchor}\n\n${body}`;
const second =
  '<a id="vext-http-002"></a>\n\n### VEXT-HTTP-002 [SHOULD] Second\n\nOther body.';
const hash = (text) => createHash("sha256").update(text).digest("hex");

test("hash covers the complete rule including code, but excludes adjacent anchors", () => {
  const rules = parseSpecificationRules(`${first}\n\n${second}`);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].contentHash, hash(body));
  assert.equal(rules[0].title, "Read `req.valid()`");
  assert.equal(rules[1].level, "should");
  assert.equal(
    parseSpecificationRules(`${first}\n\n${second.replaceAll("002", "003")}`)[0]
      .contentHash,
    rules[0].contentHash,
  );
  assert.notEqual(
    parseSpecificationRules(first.replace("value = 1", "value = 2"))[0]
      .contentHash,
    rules[0].contentHash,
  );
  assert.equal(
    parseSpecificationRules(first.replaceAll("\n", "  \r\n"))[0].contentHash,
    rules[0].contentHash,
  );
});

for (const fence of ["```", "~~~", "````", "  ~~~~"]) {
  test(`ignores fake rules inside ${JSON.stringify(fence)} fences`, () => {
    const code = `${fence}md\n### VEXT-HTTP-999 [INVALID] fake\n${fence}`;
    assert.equal(parseSpecificationRules(`${code}\n${first}`).length, 1);
    assert.equal(
      parseSpecificationRules(`${first}\n${code}\n${second}`)[0].contentHash,
      hash(`${body}\n${code}`),
    );
  });
}

test("frontmatter, comments and inline code do not create rules", () => {
  const fake = "### VEXT-HTTP-900 [BAD] Fake";
  assert.equal(
    parseSpecificationRules(
      `---\n${fake}\n---\n<!--\n${fake}\n-->\n\`${fake}\`\n${first}`,
    ).length,
    1,
  );
});

test("inline examples of anchors do not create duplicate or orphan anchors", () => {
  assert.equal(
    parseSpecificationRules(
      `\`${anchor}\`\n\`<a id="vext-http-900"></a>\`\n${first}`,
    ).length,
    1,
  );
});

for (const [name, source] of [
  ["invalid level", first.replace("[MUST]", "[REQUIRED]")],
  ["invalid domain", first.replaceAll("HTTP", "UNKNOWN")],
  ["invalid ID digits", first.replaceAll("001", "01")],
  ["wrong heading level", first.replace("###", "##")],
  ["missing anchor", body],
  ["wrong anchor", first.replace("vext-http-001", "vext-http-009")],
  ["duplicate anchor", `${anchor}\n${first}`],
  ["detached anchor", first.replace("\n\n", "\nparagraph\n")],
  ["orphan anchor", `${first}\n<a id="vext-http-002"></a>`],
  ["duplicate rule", `${first}\n${first}`],
]) {
  test(`rejects ${name}`, () =>
    assert.throws(() => parseSpecificationRules(source)));
}

test("a higher-level section ends a rule", () => {
  assert.equal(
    parseSpecificationRules(`${first}\n\n## Related\nLink`)[0].contentHash,
    hash(body),
  );
});
