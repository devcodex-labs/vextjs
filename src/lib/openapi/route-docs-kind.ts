import type { VextHandler } from "../../types/middleware.js";
import type { VextOpenAPIDocsKind } from "./types.js";

const RESPONSE_RENDER_PATTERN =
  /\b[A-Za-z_$][\w$]*\s*\.\s*(render|renderError)\s*\(/u;

export function detectRouteDocsKind(
  handler?: VextHandler,
): VextOpenAPIDocsKind {
  return handler && detectRenderCall(handler)
    ? "frontend-route"
    : "backend-api";
}

export function detectRenderCall(handler: VextHandler): boolean {
  const source = stripCommentsAndStrings(
    Function.prototype.toString.call(handler),
  );
  return RESPONSE_RENDER_PATTERN.test(source);
}

function stripCommentsAndStrings(source: string): string {
  let output = "";
  let index = 0;
  let state:
    | "code"
    | "single"
    | "double"
    | "template"
    | "line-comment"
    | "block-comment" = "code";

  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (state === "code") {
      if (char === "'" || char === '"' || char === "`") {
        state = char === "'" ? "single" : char === '"' ? "double" : "template";
        output += " ";
      } else if (char === "/" && next === "/") {
        state = "line-comment";
        output += "  ";
        index++;
      } else if (char === "/" && next === "*") {
        state = "block-comment";
        output += "  ";
        index++;
      } else {
        output += char;
      }
      index++;
      continue;
    }

    if (state === "line-comment") {
      if (char === "\n" || char === "\r") {
        state = "code";
        output += char;
      } else {
        output += " ";
      }
      index++;
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        output += "  ";
        index += 2;
      } else {
        output += char === "\n" || char === "\r" ? char : " ";
        index++;
      }
      continue;
    }

    const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
    if (char === "\\") {
      output += " ";
      index += 2;
      continue;
    }
    if (char === quote) {
      state = "code";
      output += " ";
      index++;
      continue;
    }
    output += char === "\n" || char === "\r" ? char : " ";
    index++;
  }

  return output;
}
