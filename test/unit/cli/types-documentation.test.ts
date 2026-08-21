import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const CLI_DOCS = {
  en: "website/docs/en/guide/cli.md",
  zh: "website/docs/zh/guide/cli.md",
};

const PROJECT_STRUCTURE_DOCS = {
  en: "website/docs/en/frontend/project-structure.md",
  zh: "website/docs/zh/frontend/project-structure.md",
};

describe("scaffold type-directory documentation", () => {
  it("keeps the documented TypeScript scaffold boundaries aligned with create", () => {
    const createSource = readRepoFile("src/cli/create.ts");

    expect(createSource).toContain(
      'files["src/types/generated/.gitkeep"] = ""',
    );
    expect(createSource).toContain(
      'files["src/types/shared/greeting.d.ts"] = generateGreetingType()',
    );
    expect(createSource).toContain(
      'files["src/types/frontend/home.d.ts"] = generateFrontendHomeType()',
    );
    expect(createSource).not.toContain("src/types/server/.gitkeep");
  });

  it("documents the same three ownership boundaries in English and Chinese", () => {
    const docs = [
      ...Object.values(CLI_DOCS),
      ...Object.values(PROJECT_STRUCTURE_DOCS),
    ].map(readRepoFile);

    for (const document of docs) {
      expect(document).toContain("src/types/generated/**");
      expect(document).toContain("src/types/shared/**");
      expect(document).toContain("src/types/frontend/**");
      expect(document).toContain("src/types/server/**");
    }

    expect(readRepoFile(CLI_DOCS.en)).toContain(
      "TypeScript API-only (`--template api --frontend none`)",
    );
    expect(readRepoFile(CLI_DOCS.zh)).toContain(
      "TypeScript API-only（`--template api --frontend none`）",
    );
    expect(readRepoFile(PROJECT_STRUCTURE_DOCS.en)).toMatch(
      /JavaScript starter\s*\|\s*No `src\/types` directory/,
    );
    expect(readRepoFile(PROJECT_STRUCTURE_DOCS.zh)).toMatch(
      /JavaScript 脚手架\s*\|\s*不生成 `src\/types` 目录/,
    );
  });

  it("keeps typegen ownership limited to generated declarations", () => {
    const typegenSource = readRepoFile("src/cli/typegen.ts");
    const cliDocs = Object.values(CLI_DOCS).map(readRepoFile);

    expect(typegenSource).toContain("src/types/generated/index.d.ts");
    expect(typegenSource).not.toContain("src/types/shared");
    expect(typegenSource).not.toContain("src/types/frontend");

    for (const document of cliDocs) {
      expect(document).toContain("src/types/generated/**");
    }
  });
});
