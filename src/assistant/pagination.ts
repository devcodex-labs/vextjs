import { createHash } from "node:crypto";
import {
  createAssistantFailure,
  type VextAssistantValidationResult,
} from "./contracts.js";

export interface AssistantPage<T> {
  items: T[];
  total: number;
  truncated: boolean;
  nextCursor: string | null;
}

interface PageCursor {
  schemaVersion: 2;
  identityDigest: string;
  section: string;
  sortKey: "source-key-v1";
  offset: number;
}

/** Cursor 绑定内容身份和集合；只是位置标记，不授予任何读取或写入能力。 */
export function paginateAssistantItems<T>(
  items: readonly T[],
  options: {
    identity: unknown;
    section: string;
    limit?: number;
    cursor?: string;
    maxBytes?: number;
  },
): VextAssistantValidationResult<AssistantPage<T>> {
  const identityDigest = createHash("sha256")
    .update(JSON.stringify(options.identity))
    .digest("hex");
  let offset = 0;
  if (options.cursor !== undefined) {
    const cursor = decodeCursor(options.cursor);
    if (!cursor)
      return {
        ok: false,
        failure: createAssistantFailure(
          "VEXT_VALIDATION_FAILED",
          "Malformed inspection cursor.",
        ),
        warnings: [],
      };
    if (
      cursor.identityDigest !== identityDigest ||
      cursor.section !== options.section ||
      cursor.offset >= items.length
    ) {
      return {
        ok: false,
        failure: createAssistantFailure(
          "VEXT_CURSOR_STALE",
          "Cursor no longer matches this project, policy, section or collection. Inspect the first page again.",
          "refresh",
        ),
        warnings: [],
      };
    }
    offset = cursor.offset;
  }
  const page = items.slice(offset, offset + (options.limit ?? 100));
  if (
    Buffer.byteLength(JSON.stringify(page), "utf8") >
    Math.min(options.maxBytes ?? 256 * 1024, 256 * 1024)
  )
    return {
      ok: false,
      failure: createAssistantFailure(
        "VEXT_RESPONSE_LIMIT",
        "Inspection page exceeds its byte budget (at most 256 KiB). Reduce limit; an oversized individual item requires host-side source inspection.",
      ),
      warnings: [],
    };
  const truncated = offset + page.length < items.length;
  const cursor: PageCursor = {
    schemaVersion: 2,
    identityDigest,
    section: options.section,
    sortKey: "source-key-v1",
    offset: offset + page.length,
  };
  return {
    ok: true,
    warnings: [],
    value: {
      items: page,
      total: items.length,
      truncated,
      nextCursor: truncated
        ? Buffer.from(JSON.stringify(cursor)).toString("base64url")
        : null,
    },
  };
}

function decodeCursor(input: string): PageCursor | undefined {
  if (!input || input.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(input))
    return undefined;
  try {
    const bytes = Buffer.from(input, "base64url");
    if (bytes.toString("base64url") !== input) return undefined;
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return undefined;
    const value = parsed as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(",") !==
      "identityDigest,offset,schemaVersion,section,sortKey"
    )
      return undefined;
    if (
      value.schemaVersion !== 2 ||
      value.sortKey !== "source-key-v1" ||
      typeof value.identityDigest !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.identityDigest) ||
      typeof value.section !== "string" ||
      value.section.length > 100 ||
      !Number.isSafeInteger(value.offset) ||
      (value.offset as number) <= 0
    )
      return undefined;
    return value as unknown as PageCursor;
  } catch {
    return undefined;
  }
}
