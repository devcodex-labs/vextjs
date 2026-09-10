export interface RootRef {
  readonly id: string;
  readonly realPath: string;
  readonly kind: "service" | "shared";
  /** 显式分析映射，由collector与真实package声明交叉校验；不改变运行时exports。 */
  readonly packageName?: string;
  readonly sourceExports?: Readonly<Record<string, string>>;
}

export interface SourceFileRef {
  readonly rootId: string;
  readonly path: string;
  readonly role: string;
}

export interface SourceRecord extends SourceFileRef {
  readonly sha256: string;
  readonly byteLength: number;
  readonly encoding: "utf8";
  readonly bom: boolean;
  readonly newline: "lf" | "crlf" | "mixed";
}

export interface SourceView {
  readonly revision: string;
  roots(): readonly RootRef[];
  list(filter?: {
    rootId?: string;
    roles?: readonly string[];
  }): readonly SourceRecord[];
  read(rootId: string, relativePath: string): string | undefined;
  record(rootId: string, relativePath: string): SourceRecord | undefined;
}

export interface SourceInput extends SourceFileRef {
  readonly bytes: Uint8Array;
}

export interface SourceLimits {
  /** 目录发现的总条目预算，包含最终未选择的文件；不等于MCP响应预算。 */
  readonly maxScanEntries?: number;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export interface SourceViewOptions {
  readonly roots: readonly RootRef[];
  readonly rolePolicyVersion: string;
  readonly limits?: Partial<SourceLimits>;
}

export type SourceChange =
  | (SourceInput & { readonly kind: "create" })
  | {
      readonly kind: "replace";
      readonly rootId: string;
      readonly path: string;
      readonly expectedSha256: string;
      readonly bytes: Uint8Array;
      readonly role?: string;
    }
  | {
      readonly kind: "delete";
      readonly rootId: string;
      readonly path: string;
      readonly expectedSha256: string;
    };

export class SourceViewError extends Error {
  constructor(
    readonly code:
      | "VEXT_SOURCE_UNVERIFIED"
      | "VEXT_SOURCE_LIMIT"
      | "VEXT_SOURCE_CHANGED"
      | "VEXT_SOURCE_CANCELLED",
    message: string,
    options?: ErrorOptions,
  ) {
    super("[vextjs] " + message, options);
    this.name = "SourceViewError";
  }
}
