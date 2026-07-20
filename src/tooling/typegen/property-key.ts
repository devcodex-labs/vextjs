const IDENTIFIER_PROPERTY_NAME = /^[A-Za-z_$][\w$]*$/u;
const TYPESCRIPT_RESERVED_PROPERTY_NAMES = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "as",
  "async",
  "await",
  "from",
  "get",
  "implements",
  "interface",
  "let",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "set",
  "static",
  "yield",
]);

const RUNTIME_RESERVED_EXTENSION_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "then",
  "toString",
  "valueOf",
  "hasOwnProperty",
]);

export function renderTypePropertyKey(key: string): string {
  if (
    IDENTIFIER_PROPERTY_NAME.test(key) &&
    !TYPESCRIPT_RESERVED_PROPERTY_NAMES.has(key)
  ) {
    return key;
  }

  return renderTypeStringLiteral(key);
}

export function renderTypeStringLiteral(value: string): string {
  return JSON.stringify(value);
}

export function isRuntimeAppExtensionKey(key: string): boolean {
  return (
    key.length > 0 &&
    IDENTIFIER_PROPERTY_NAME.test(key) &&
    !RUNTIME_RESERVED_EXTENSION_KEYS.has(key) &&
    !(key in Object.prototype)
  );
}
