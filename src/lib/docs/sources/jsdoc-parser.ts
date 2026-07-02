import type { VextCodeDocParam } from "../types.js";

export type ParsedJSDocKind = "function" | "class" | "const" | "method";

export interface ParsedJSDocSymbol {
  exportName: string;
  kind: ParsedJSDocKind;
  line?: number;
  summary?: string;
  description?: string;
  params?: VextCodeDocParam[];
  returns?: { type?: string; description?: string };
  throws?: Array<{ type?: string; description?: string }>;
  examples?: string[];
  deprecated?: boolean | string;
}

export function parseJSDocSymbols(source: string): ParsedJSDocSymbol[] {
  const symbols: ParsedJSDocSymbol[] = [];
  const blockPattern = /\/\*\*([\s\S]*?)\*\//g;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(source)) !== null) {
    const block = match[0];
    const declaration = source.slice(blockPattern.lastIndex).trimStart();
    const declarationInfo = inferDeclaration(declaration);
    if (!declarationInfo) {
      continue;
    }

    symbols.push({
      ...declarationInfo,
      ...parseJSDocBlock(block),
      line: lineNumberAt(source, match.index),
    });
  }

  return symbols.filter(
    (symbol) => Boolean(symbol.summary) || Boolean(symbol.description),
  );
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/u).length;
}

function parseJSDocBlock(
  block: string,
): Omit<ParsedJSDocSymbol, "exportName" | "kind"> {
  const lines = block
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\*\s?/u, "").trimEnd());

  const description: string[] = [];
  const params: VextCodeDocParam[] = [];
  const throwsTags: Array<{ type?: string; description?: string }> = [];
  const examples: string[] = [];
  let returns: { type?: string; description?: string } | undefined;
  let deprecated: boolean | string | undefined;
  let currentExample: string[] | undefined;

  const finishExample = () => {
    if (currentExample) {
      const text = currentExample.join("\n").trim();
      if (text) {
        examples.push(text);
      }
      currentExample = undefined;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("@")) {
      finishExample();
      if (line.startsWith("@param")) {
        params.push(parseParamTag(line));
      } else if (line.startsWith("@returns") || line.startsWith("@return")) {
        returns = parseTypeDescriptionTag(line);
      } else if (line.startsWith("@throws") || line.startsWith("@exception")) {
        throwsTags.push(parseTypeDescriptionTag(line));
      } else if (line.startsWith("@example")) {
        currentExample = [line.replace(/^@example\s*/u, "")];
      } else if (line.startsWith("@deprecated")) {
        const reason = line.replace(/^@deprecated\s*/u, "").trim();
        deprecated = reason || true;
      }
      continue;
    }

    if (currentExample) {
      currentExample.push(rawLine);
    } else if (line) {
      description.push(line);
    }
  }
  finishExample();

  const summary = description[0];
  return {
    summary,
    description: description.join("\n"),
    params: params.length > 0 ? params : undefined,
    returns,
    throws: throwsTags.length > 0 ? throwsTags : undefined,
    examples: examples.length > 0 ? examples : undefined,
    deprecated,
  };
}

function parseParamTag(line: string): VextCodeDocParam {
  const content = line.replace(/^@param\s*/u, "").trim();
  const match = content.match(
    /^(?:\{([^}]+)\}\s*)?(\[?[A-Za-z0-9_.$-]+(?:=[^\]]+)?\]?)?\s*-?\s*(.*)$/u,
  );
  const rawName = match?.[2] ?? "param";
  const optional = rawName.startsWith("[");
  const name = rawName.replace(/^\[/u, "").replace(/\]$/u, "").split("=")[0]!;
  return {
    name,
    type: match?.[1],
    description: match?.[3] || undefined,
    optional,
  };
}

function parseTypeDescriptionTag(line: string): {
  type?: string;
  description?: string;
} {
  const content = line.replace(/^@(returns?|throws|exception)\s*/u, "").trim();
  const match = content.match(/^(?:\{([^}]+)\}\s*)?\s*-?\s*(.*)$/u);
  return {
    type: match?.[1],
    description: match?.[2] || undefined,
  };
}

function inferDeclaration(
  declaration: string,
): Pick<ParsedJSDocSymbol, "exportName" | "kind"> | null {
  const snippet = declaration.slice(0, 320).replace(/\s+/gu, " ");
  const patterns: Array<[RegExp, ParsedJSDocKind]> = [
    [/^export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)?/u, "function"],
    [/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/u, "function"],
    [/^export\s+class\s+([A-Za-z_$][\w$]*)/u, "class"],
    [/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u, "const"],
    [/^export\s+default\s+/u, "const"],
    [/^exports\.([A-Za-z_$][\w$]*)\s*=/u, "const"],
    [/^module\.exports\s*=\s*([A-Za-z_$][\w$]*)?/u, "const"],
  ];

  for (const [pattern, kind] of patterns) {
    const match = snippet.match(pattern);
    if (match) {
      return { exportName: match[1] ?? "default", kind };
    }
  }

  const methodMatch = snippet.match(
    /^((?:public\s+|private\s+|protected\s+|static\s+|async\s+)*)?([A-Za-z_$][\w$]*)\s*\(/u,
  );
  if (methodMatch) {
    const modifiers = methodMatch[1] ?? "";
    const name = methodMatch[2] ?? "";
    if (
      /\b(private|protected)\b/u.test(modifiers) ||
      name === "constructor" ||
      name.startsWith("_")
    ) {
      return null;
    }
    return { exportName: name, kind: "method" };
  }

  return null;
}
