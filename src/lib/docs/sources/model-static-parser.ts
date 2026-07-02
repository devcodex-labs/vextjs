import { SchemaConverter } from "../../openapi/schema-converter.js";
import type {
  VextModelDetails,
  VextModelEnumDoc,
  VextModelFieldDoc,
  VextModelHookDoc,
  VextModelIndexDoc,
  VextModelOptionDoc,
} from "../types.js";

export interface StaticModelDocs {
  definition: Record<string, unknown>;
  details: Omit<VextModelDetails, "registryKey" | "depth" | "usage">;
  defaultExportLine?: number;
}

const converter = new SchemaConverter();

export function extractStaticModelDocs(source: string): StaticModelDocs {
  const exported = findDefaultExportObject(source);
  if (!exported) {
    return {
      definition: {},
      details: {
        parseStatus: "unavailable",
        parseNote: "Could not locate a static default model object.",
      },
    };
  }

  const body = exported.body;
  const definition = parseDefinitionShape(body);
  const fields = parseSchemaFields(findTopLevelProperty(body, "schema"));
  const enums = parseEnums(findTopLevelProperty(body, "enums"));
  const options = parseOptions(findTopLevelProperty(body, "options"));
  const indexes = parseIndexes(findTopLevelProperty(body, "indexes"));
  const methods = parseMethods(findTopLevelProperty(body, "methods"));
  const hooks = parseHooks(findTopLevelProperty(body, "hooks"));

  const hasDetails =
    fields.length > 0 ||
    enums.length > 0 ||
    options.length > 0 ||
    indexes.length > 0 ||
    Boolean(methods.instance?.length || methods.static?.length) ||
    hooks.length > 0;

  return {
    definition,
    defaultExportLine: exported.line,
    details: {
      name: typeof definition.name === "string" ? definition.name : undefined,
      collection:
        typeof definition.collection === "string"
          ? definition.collection
          : undefined,
      connection: isStringRecord(definition.connection)
        ? definition.connection
        : undefined,
      fields: fields.length > 0 ? fields : undefined,
      enums: enums.length > 0 ? enums : undefined,
      options: options.length > 0 ? options : undefined,
      indexes: indexes.length > 0 ? indexes : undefined,
      methods:
        methods.instance?.length || methods.static?.length
          ? methods
          : undefined,
      hooks: hooks.length > 0 ? hooks : undefined,
      parseStatus: hasDetails ? "complete" : "partial",
      parseNote: hasDetails
        ? undefined
        : "Static model object found, but no supported schema/enums/options/indexes/methods/hooks shape was detected.",
    },
  };
}

function parseDefinitionShape(body: string): Record<string, unknown> {
  const definition: Record<string, unknown> = {};
  const name = readStringLiteral(findTopLevelProperty(body, "name"));
  const collection = readStringLiteral(findTopLevelProperty(body, "collection"));
  const connection = parseStringRecord(findTopLevelProperty(body, "connection"));
  if (name) definition.name = name;
  if (collection) definition.collection = collection;
  if (connection) definition.connection = connection;
  return definition;
}

function parseSchemaFields(value: string | undefined): VextModelFieldDoc[] {
  if (!value) return [];
  const schemaObject = findCallObjectArgument(value, "dsl");
  if (!schemaObject) return [];
  return parseDslObjectFields(schemaObject);
}

function parseDslObjectFields(
  objectBody: string,
  prefix = "",
): VextModelFieldDoc[] {
  const rows: VextModelFieldDoc[] = [];
  for (const [name, value] of topLevelProperties(objectBody)) {
    const fieldName = prefix ? `${prefix}.${name}` : name;
    const stringValue = readStringLiteral(value);
    const nested = findCallObjectArgument(value, "dsl");
    if (stringValue !== undefined) {
      rows.push(createFieldDoc(fieldName, stringValue));
    } else if (nested) {
      rows.push({
        name: fieldName,
        required: false,
        type: "object",
        description: "Nested object.",
      });
      rows.push(...parseDslObjectFields(nested, fieldName));
    } else {
      rows.push({
        name: fieldName,
        required: false,
        type: "unknown",
        raw: compact(value),
      });
    }
  }
  return rows;
}

function createFieldDoc(name: string, raw: string): VextModelFieldDoc {
  try {
    const converted = converter.convertDSLString(raw);
    const schema = converted.schema as Record<string, unknown>;
    const enumValues = Array.isArray(schema.enum)
      ? schema.enum.map((value) => String(value))
      : undefined;
    return {
      name,
      required: converted.isRequired,
      type: describeSchema(schema),
      description:
        typeof schema.description === "string" ? schema.description : undefined,
      enum: enumValues,
      raw,
    };
  } catch {
    return {
      name,
      required: raw.endsWith("!"),
      type: raw.replace(/[!?]$/u, ""),
      raw,
    };
  }
}

function describeSchema(schema: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof schema.type === "string") parts.push(schema.type);
  if (typeof schema.format === "string") parts.push(`(${schema.format})`);
  if (Array.isArray(schema.enum)) {
    parts.push(`enum: ${schema.enum.map((value) => String(value)).join(", ")}`);
  }
  if (schema.nullable === true) parts.push("nullable");
  return parts.join(" ") || "unknown";
}

function parseEnums(value: string | undefined): VextModelEnumDoc[] {
  const objectBody = unwrapObject(value);
  if (!objectBody) return [];
  return topLevelProperties(objectBody)
    .map(([name, entry]) => {
      const raw = readStringLiteral(entry);
      if (!raw) return undefined;
      const separator = raw.includes("|") ? "|" : ",";
      return {
        name,
        values: raw
          .split(separator)
          .map((part) => part.trim())
          .filter(Boolean),
      };
    })
    .filter(Boolean) as VextModelEnumDoc[];
}

function parseOptions(value: string | undefined): VextModelOptionDoc[] {
  const objectBody = unwrapObject(value);
  if (!objectBody) return [];
  return topLevelProperties(objectBody).map(([name, entry]) => ({
    name,
    value: compact(entry),
  }));
}

function parseIndexes(value: string | undefined): VextModelIndexDoc[] {
  const arrayBody = unwrapArray(value);
  if (!arrayBody) return [];
  return splitTopLevel(arrayBody)
    .map((entry) => unwrapObject(entry))
    .filter(Boolean)
    .map((entry) => {
      const key = findTopLevelProperty(entry!, "key");
      const unique = readBooleanLiteral(findTopLevelProperty(entry!, "unique"));
      const options = topLevelProperties(entry!)
        .filter(([name]) => name !== "key" && name !== "unique")
        .map(([name, option]) => `${name}: ${compact(option)}`)
        .join(", ");
      return {
        keys: key ? compact(key) : "",
        unique,
        options: options || undefined,
      };
    })
    .filter((entry) => entry.keys);
}

function parseMethods(value: string | undefined): {
  instance?: string[];
  static?: string[];
} {
  const body = extractReturnedObject(value);
  if (!body) return {};
  const instance = methodNames(unwrapObject(findTopLevelProperty(body, "instance")));
  const staticMethods = methodNames(unwrapObject(findTopLevelProperty(body, "static")));
  return {
    instance: instance.length > 0 ? instance : undefined,
    static: staticMethods.length > 0 ? staticMethods : undefined,
  };
}

function parseHooks(value: string | undefined): VextModelHookDoc[] {
  const body = extractReturnedObject(value);
  if (!body) return [];
  return topLevelProperties(body)
    .map(([operation, entry]) => {
      const phases = methodNames(unwrapObject(entry)).filter((name) =>
        ["before", "after", "error"].includes(name),
      );
      return phases.length > 0 ? { operation, phases } : undefined;
    })
    .filter(Boolean) as VextModelHookDoc[];
}

function methodNames(objectBody: string | undefined): string[] {
  if (!objectBody) return [];
  const names: string[] = [];
  for (const entry of splitTopLevel(objectBody)) {
    const text = entry.trim();
    const methodMatch = text.match(
      /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]+>)?\s*\(/u,
    );
    const propertyMatch = text.match(/^([A-Za-z_$][\w$]*)\s*:/u);
    const name = methodMatch?.[1] ?? propertyMatch?.[1];
    if (name && name !== "constructor" && !name.startsWith("_")) {
      names.push(name);
    }
  }
  return names;
}

function extractReturnedObject(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const arrowIndex = value.indexOf("=>");
  if (arrowIndex !== -1) {
    const afterArrow = value.slice(arrowIndex + 2);
    const wrapped = unwrapParenthesizedObject(afterArrow);
    if (wrapped) return wrapped;
  }
  const returnIndex = value.indexOf("return");
  if (returnIndex !== -1) {
    const returned = value.slice(returnIndex + "return".length);
    const wrapped = unwrapParenthesizedObject(returned) ?? unwrapObject(returned);
    if (wrapped) return wrapped;
  }
  return unwrapParenthesizedObject(value) ?? unwrapObject(value);
}

function findDefaultExportObject(
  source: string,
): { body: string; line: number } | undefined {
  const patterns = [/export\s+default\s*\{/u, /module\.exports\s*=\s*\{/u];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const openIndex = source.indexOf("{", match.index);
    const balanced = readBalanced(source, openIndex);
    if (balanced) {
      return {
        body: balanced.body,
        line: lineNumberAt(source, openIndex),
      };
    }
  }
  return undefined;
}

function findTopLevelProperty(
  objectBody: string,
  propertyName: string,
): string | undefined {
  return topLevelProperties(objectBody).find(([name]) => name === propertyName)?.[1];
}

function topLevelProperties(objectBody: string): Array<[string, string]> {
  return splitTopLevel(objectBody)
    .map((entry): [string, string] | undefined => {
      const colon = findTopLevelColon(entry);
      if (colon === -1) return undefined;
      const rawName = entry.slice(0, colon).trim();
      const name =
        readStringLiteral(rawName) ??
        rawName.replace(/^(?:async\s+)?/u, "").match(/^([A-Za-z_$][\w$]*)/u)?.[1];
      if (!name) return undefined;
      return [name, entry.slice(colon + 1).trim()];
    })
    .filter(Boolean) as Array<[string, string]>;
}

function findCallObjectArgument(
  source: string,
  callName: string,
): string | undefined {
  let index = 0;
  while (index < source.length) {
    const found = source.indexOf(callName, index);
    if (found === -1) return undefined;
    const before = source[found - 1];
    const afterName = source[found + callName.length];
    if (
      (before && /[\w$]/u.test(before)) ||
      (afterName && /[\w$]/u.test(afterName))
    ) {
      index = found + callName.length;
      continue;
    }
    const openParen = source.indexOf("(", found + callName.length);
    if (openParen === -1) return undefined;
    const args = readBalanced(source, openParen);
    if (!args) return undefined;
    const first = args.body.trim();
    const objectBody = unwrapObject(first);
    if (objectBody) return objectBody;
    index = args.endIndex + 1;
  }
  return undefined;
}

function unwrapParenthesizedObject(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("(")) return undefined;
  const balanced = readBalanced(trimmed, 0);
  if (!balanced) return undefined;
  return unwrapObject(balanced.body.trim());
}

function unwrapObject(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const openIndex = trimmed.indexOf("{");
  if (openIndex === -1) return undefined;
  const balanced = readBalanced(trimmed, openIndex);
  return balanced?.body;
}

function unwrapArray(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const openIndex = trimmed.indexOf("[");
  if (openIndex === -1) return undefined;
  const balanced = readBalanced(trimmed, openIndex);
  return balanced?.body;
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let state: "normal" | "single" | "double" | "template" | "line" | "block" =
    "normal";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];
    if (state === "line") {
      if (char === "\n") state = "normal";
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        state = "normal";
        index += 1;
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "normal";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      state = "line";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block";
      index += 1;
      continue;
    }
    if (char === "'") {
      state = "single";
      continue;
    }
    if (char === '"') {
      state = "double";
      continue;
    }
    if (char === "`") {
      state = "template";
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      const part = source.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function findTopLevelColon(source: string): number {
  let depth = 0;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") depth -= 1;
    if (char === ":" && depth === 0) return index;
  }
  return -1;
}

function readBalanced(
  source: string,
  openIndex: number,
): { body: string; endIndex: number } | undefined {
  const open = source[openIndex];
  const close = open === "{" ? "}" : open === "[" ? "]" : open === "(" ? ")" : "";
  if (!close) return undefined;
  let depth = 0;
  let state: "normal" | "single" | "double" | "template" | "line" | "block" =
    "normal";

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];
    if (state === "line") {
      if (char === "\n") state = "normal";
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        state = "normal";
        index += 1;
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "normal";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      state = "line";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block";
      index += 1;
      continue;
    }
    if (char === "'") {
      state = "single";
      continue;
    }
    if (char === '"') {
      state = "double";
      continue;
    }
    if (char === "`") {
      state = "template";
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          body: source.slice(openIndex + 1, index),
          endIndex: index,
        };
      }
    }
  }
  return undefined;
}

function readStringLiteral(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return undefined;
  let result = "";
  for (let index = 1; index < trimmed.length; index += 1) {
    const char = trimmed[index]!;
    if (char === "\\") {
      result += trimmed[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (char === quote) return result;
    result += char;
  }
  return undefined;
}

function readBooleanLiteral(value: string | undefined): boolean | undefined {
  const trimmed = value?.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return undefined;
}

function parseStringRecord(
  value: string | undefined,
): Record<string, string> | undefined {
  const body = unwrapObject(value);
  if (!body) return undefined;
  const record: Record<string, string> = {};
  for (const [name, entry] of topLevelProperties(body)) {
    const literal = readStringLiteral(entry);
    if (literal !== undefined) record[name] = literal;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/u).length;
}
