export type VextJscssPrimitive = string | number | boolean;

export interface VextJscssVariable {
  name: string;
  ref: string;
  fallback?: string;
}

export type VextJscssValue =
  | VextJscssPrimitive
  | VextJscssVariable
  | undefined
  | null;

export interface VextJscssRule {
  [property: string]: VextJscssValue | VextJscssRule;
}

export interface VextStyleOptions {
  name?: string;
}

export interface VextRecipeConfig {
  name?: string;
  base?: VextJscssRule;
  variants?: Record<string, Record<string, VextJscssRule>>;
  defaultVariants?: Record<string, string>;
}

export type VextRecipeSelection = Record<string, string | undefined>;

export interface VextRecipe {
  (selection?: VextRecipeSelection): string;
  className: string;
  variants: Record<string, Record<string, string>>;
}

type StyleSheetRecord = {
  key: string;
  css: string;
};

type VextJscssRuntimeAdapter = "css-variables" | "none" | false;

interface VextJscssRuntimeConfig {
  runtimeAdapter: VextJscssRuntimeAdapter;
  dynamicVars: boolean;
  recipes: boolean;
}

declare const __VEXT_JSCSS_RUNTIME_ADAPTER__:
  | VextJscssRuntimeAdapter
  | undefined;
declare const __VEXT_JSCSS_DYNAMIC_VARS__: boolean | undefined;
declare const __VEXT_JSCSS_RECIPES__: boolean | undefined;

const sheet = new Map<string, StyleSheetRecord>();
const runtimeConfig = readRuntimeConfig();

export function style(
  rule: VextJscssRule,
  options?: string | VextStyleOptions,
): string {
  const name = typeof options === "string" ? options : options?.name;
  const className = createClassName("style", name, rule);
  registerCss(className, renderRule(`.${className}`, rule));
  return className;
}

export function globalStyle(selector: string, rule: VextJscssRule): string {
  const key = `global:${selector}:${stableHash(stableStringify(rule))}`;
  if (!sheet.has(key)) {
    sheet.set(key, { key, css: renderRule(selector, rule) });
  }
  return selector;
}

export function recipe(config: VextRecipeConfig): VextRecipe {
  const baseClass = style(config.base ?? {}, {
    name: config.name ?? "recipe",
  });
  if (!runtimeConfig.recipes) {
    const resolveBaseRecipe = () => baseClass;
    return Object.assign(resolveBaseRecipe, {
      className: baseClass,
      variants: {},
    });
  }

  const variants: Record<string, Record<string, string>> = {};

  for (const [variantName, values] of Object.entries(config.variants ?? {})) {
    variants[variantName] = {};
    for (const [valueName, rule] of Object.entries(values)) {
      variants[variantName][valueName] = style(rule, {
        name: `${config.name ?? "recipe"}-${variantName}-${valueName}`,
      });
    }
  }

  const resolveRecipe = (selection: VextRecipeSelection = {}) => {
    const classes = [baseClass];
    const mergedSelection = {
      ...(config.defaultVariants ?? {}),
      ...selection,
    };
    for (const [variantName, valueName] of Object.entries(mergedSelection)) {
      const className = valueName
        ? variants[variantName]?.[valueName]
        : undefined;
      if (className) classes.push(className);
    }
    return classes.join(" ");
  };

  return Object.assign(resolveRecipe, {
    className: baseClass,
    variants,
  });
}

export function createVar(name: string, fallback?: string): VextJscssVariable {
  const variableName = name.startsWith("--") ? name : `--vext-${slugify(name)}`;
  return {
    name: variableName,
    fallback,
    ref: fallback
      ? `var(${variableName}, ${fallback})`
      : `var(${variableName})`,
  };
}

export function setVar(
  variable: VextJscssVariable | string,
  value: string | number,
): Record<string, string | number> {
  if (!areDynamicVarsEnabled()) return {};
  const name =
    typeof variable === "string"
      ? variable.startsWith("--")
        ? variable
        : `--vext-${slugify(variable)}`
      : variable.name;
  return { [name]: value };
}

export function vars(
  values: Record<string, string | number>,
): Record<string, string | number> {
  return values;
}

export function __vextGetStyleSheet(): string {
  return [...sheet.values()]
    .map((record) => record.css)
    .filter(Boolean)
    .join("\n");
}

export function __vextResetStyleSheet(): void {
  sheet.clear();
}

function registerCss(className: string, css: string): void {
  if (!sheet.has(className)) {
    sheet.set(className, { key: className, css });
  }
}

function renderRule(selector: string, rule: VextJscssRule): string {
  const declarations: string[] = [];
  const nested: string[] = [];

  for (const [property, rawValue] of Object.entries(rule)) {
    if (rawValue === undefined || rawValue === null) continue;
    if (isNestedRule(rawValue)) {
      nested.push(renderNestedRule(selector, property, rawValue));
      continue;
    }
    const value = toCssValue(property, rawValue);
    if (value === undefined) continue;
    declarations.push(`${toKebabCase(property)}:${value};`);
  }

  const current = declarations.length
    ? `${selector}{${declarations.join("")}}`
    : "";
  return [current, ...nested].filter(Boolean).join("\n");
}

function renderNestedRule(
  selector: string,
  property: string,
  rule: VextJscssRule,
): string {
  if (property.startsWith("@")) {
    return `${property}{${renderRule(selector, rule)}}`;
  }
  const nestedSelector = property.includes("&")
    ? property.replaceAll("&", selector)
    : `${selector} ${property}`;
  return renderRule(nestedSelector, rule);
}

function isNestedRule(value: unknown): value is VextJscssRule {
  return Boolean(value) && typeof value === "object" && !isJscssVariable(value);
}

function isJscssVariable(value: unknown): value is VextJscssVariable {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as VextJscssVariable).name === "string" &&
    typeof (value as VextJscssVariable).ref === "string"
  );
}

function toCssValue(
  property: string,
  value: VextJscssValue,
): string | undefined {
  if (isJscssVariable(value)) {
    return areDynamicVarsEnabled() ? value.ref : value.fallback;
  }
  if (typeof value === "number") {
    return isUnitlessProperty(property) ? String(value) : `${value}px`;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

const unitlessProperties = new Set([
  "animationIterationCount",
  "flex",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "lineHeight",
  "opacity",
  "order",
  "zIndex",
  "zoom",
]);

function isUnitlessProperty(property: string): boolean {
  return property.startsWith("--") || unitlessProperties.has(property);
}

function areDynamicVarsEnabled(): boolean {
  return (
    runtimeConfig.dynamicVars &&
    runtimeConfig.runtimeAdapter === "css-variables"
  );
}

function readRuntimeConfig(): VextJscssRuntimeConfig {
  return {
    runtimeAdapter:
      typeof __VEXT_JSCSS_RUNTIME_ADAPTER__ === "undefined"
        ? "css-variables"
        : __VEXT_JSCSS_RUNTIME_ADAPTER__,
    dynamicVars:
      typeof __VEXT_JSCSS_DYNAMIC_VARS__ === "undefined"
        ? true
        : __VEXT_JSCSS_DYNAMIC_VARS__,
    recipes:
      typeof __VEXT_JSCSS_RECIPES__ === "undefined"
        ? true
        : __VEXT_JSCSS_RECIPES__,
  };
}

function createClassName(
  prefix: string,
  name: string | undefined,
  rule: VextJscssRule,
): string {
  const safeName = slugify(name ?? prefix);
  const hash = stableHash(`${safeName}:${stableStringify(rule)}`).slice(0, 8);
  return `vext-${safeName}-${hash}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "style";
}

function toKebabCase(value: string): string {
  if (value.startsWith("--")) return value;
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
