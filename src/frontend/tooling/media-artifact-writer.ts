import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import sharp from "sharp";
import subsetFont from "subset-font";
import type {
  ResolvedVextFrontendConfig,
  VextFrontendMode,
} from "../contract/types.js";
import { STABLE_FRONTEND_GENERATED_AT } from "../contract/metadata.js";
import { getFrontendContentType } from "../deploy/content-type.js";
import { createSha256, createSriSha256 } from "../deploy/integrity.js";
import { normalizeFallback } from "../media/font.js";
import type {
  VextFontDefinition,
  VextFontVariationAxis,
  VextFrontendMediaFont,
  VextFrontendMediaImage,
  VextFrontendMediaManifest,
  VextFrontendMediaVariant,
  VextMediaRasterFormat,
} from "../media/types.js";

const RASTER_GLOB = "**/*.{avif,jpeg,jpg,png,webp}";
const SOURCE_GLOB = "**/*.{js,jsx,ts,tsx}";
const DEFAULT_FONT_SUBSET =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

export interface WriteFrontendMediaArtifactsOptions {
  rootDir: string;
  config: ResolvedVextFrontendConfig;
  mode: VextFrontendMode;
}

export interface WriteFrontendMediaArtifactsResult {
  manifestPath: string;
  manifest: VextFrontendMediaManifest;
}

interface ParsedFontDefinition extends VextFontDefinition {
  definitionFile: string;
}

interface StagedMediaFile {
  file: string;
  stagePath: string;
  bytes: number;
}

/**
 * Direct local-media worker. It deliberately has no esbuild plugin, cloud SDK,
 * command wrapper, remote fetch, or remote cache layer.
 */
export async function writeFrontendMediaArtifacts(
  input: WriteFrontendMediaArtifactsOptions,
): Promise<WriteFrontendMediaArtifactsResult> {
  const { config } = input;
  const manifestPath = path.join(config.outDir, "media-manifest.json");
  const stageDir = path.join(config.outDir, ".vext-media-stage");
  const targetDir = path.join(
    config.outDir,
    config.build.client.assetsDir,
    "media",
  );
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  try {
    const staged: StagedMediaFile[] = [];
    const images = await writeLocalImageVariants(config, stageDir, staged);
    const fonts = await writeLocalFontSubsets(config, stageDir, staged);
    const totalBytes = staged.reduce((total, item) => total + item.bytes, 0);
    if (totalBytes > config.media.maxBytes) {
      throw new Error(
        `[vextjs] local media output (${totalBytes} bytes) exceeds config.frontend.media.maxBytes (${config.media.maxBytes} bytes).`,
      );
    }

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(path.dirname(targetDir), { recursive: true });
    await rename(stageDir, targetDir);
    const manifest: VextFrontendMediaManifest = {
      schemaVersion: 1,
      kind: "frontend-media-manifest",
      generatedAt: STABLE_FRONTEND_GENERATED_AT,
      assetBaseUrl: getAssetBase(config),
      totalBytes,
      images,
      fonts,
    };
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf-8",
    );
    return { manifestPath, manifest };
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true });
    await rm(manifestPath, { force: true });
    throw error;
  }
}

async function writeLocalImageVariants(
  config: ResolvedVextFrontendConfig,
  stageDir: string,
  staged: StagedMediaFile[],
): Promise<VextFrontendMediaImage[]> {
  if (!existsSync(config.assetsDir)) return [];
  const files = await fg(RASTER_GLOB, {
    cwd: config.assetsDir,
    absolute: true,
    onlyFiles: true,
  });
  const images: VextFrontendMediaImage[] = [];
  for (const filePath of files.sort((left, right) =>
    left.localeCompare(right),
  )) {
    const source = path.relative(config.root, filePath).replace(/\\/gu, "/");
    const sourceBuffer = await readFile(filePath);
    const metadata = await sharp(sourceBuffer, { failOn: "error" }).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) {
      throw new Error(
        `[vextjs] local image "${source}" has no intrinsic dimensions.`,
      );
    }
    if (width * height > config.media.images.maxInputPixels) {
      throw new Error(
        `[vextjs] local image "${source}" exceeds config.frontend.media.images.maxInputPixels.`,
      );
    }
    const originalFormat = resolveOriginalFormat(metadata.format, filePath);
    const widths = [
      ...new Set([
        ...config.media.images.widths.filter((item) => item < width),
        width,
      ]),
    ].sort((left, right) => left - right);
    const formats = [
      ...new Set(
        config.media.images.formats.map((format) =>
          format === "original" ? originalFormat : format,
        ),
      ),
    ];
    const variantCount = widths.length * formats.length;
    if (variantCount > config.media.images.maxVariants) {
      throw new Error(
        `[vextjs] local image "${source}" would emit ${variantCount} variants, exceeding config.frontend.media.images.maxVariants (${config.media.images.maxVariants}).`,
      );
    }
    const variants: VextFrontendMediaVariant[] = [];
    for (const variantWidth of widths) {
      for (const format of formats) {
        const identity = digestJson({
          kind: "vext-local-image-v1",
          source: createSha256(sourceBuffer),
          width: variantWidth,
          format,
          quality: config.media.images.quality,
        });
        const outputName = `${identity.slice(0, 24)}-${variantWidth}w-q${config.media.images.quality}.${format}`;
        const output = await transformImage({
          source: sourceBuffer,
          width: variantWidth,
          format,
          quality: config.media.images.quality,
        });
        const stagePath = path.join(stageDir, outputName);
        await writeFile(stagePath, output);
        const file = path.posix.join(
          config.build.client.assetsDir,
          "media",
          outputName,
        );
        const variantHeight = Math.max(
          1,
          Math.round((height * variantWidth) / width),
        );
        staged.push({ file, stagePath, bytes: output.byteLength });
        variants.push({
          file,
          src: joinAssetBase(config, file),
          width: variantWidth,
          height: variantHeight,
          format,
          quality: config.media.images.quality,
          bytes: output.byteLength,
          sha256: createSha256(output),
          integrity: createSriSha256(output),
          contentType: getFrontendContentType(outputName),
        });
      }
    }
    images.push({
      source,
      width,
      height,
      originalFormat,
      placeholder: createImagePlaceholder(width, height),
      variants: variants.sort(compareVariant),
    });
  }
  return images.sort((left, right) => left.source.localeCompare(right.source));
}

async function transformImage(input: {
  source: Buffer;
  width: number;
  format: VextMediaRasterFormat;
  quality: number;
}): Promise<Buffer> {
  const pipeline = sharp(input.source, { failOn: "error" })
    .rotate()
    .resize({ width: input.width, withoutEnlargement: true });
  if (input.format === "avif")
    return pipeline.avif({ quality: input.quality }).toBuffer();
  if (input.format === "webp")
    return pipeline.webp({ quality: input.quality }).toBuffer();
  if (input.format === "jpeg")
    return pipeline.jpeg({ quality: input.quality }).toBuffer();
  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

async function writeLocalFontSubsets(
  config: ResolvedVextFrontendConfig,
  stageDir: string,
  staged: StagedMediaFile[],
): Promise<VextFrontendMediaFont[]> {
  const definitions = await scanFontDefinitions(config);
  const emitted = new Map<string, VextFrontendMediaFont>();
  for (const definition of definitions) {
    if (isRemoteSource(definition.src)) {
      throw new Error(
        `[vextjs] defineFont() descriptor in ${toProjectRelative(config.root, definition.definitionFile)} uses a remote source. Vext never fetches remote fonts.`,
      );
    }
    const sourcePath = resolveDescriptorLocalPath(
      config.root,
      definition.definitionFile,
      definition.src,
    );
    if (!existsSync(sourcePath)) {
      throw new Error(
        `[vextjs] defineFont() local source is unreadable: ${toProjectRelative(config.root, sourcePath)}.`,
      );
    }
    const sourceBuffer = await readFile(sourcePath);
    const subset = definition.subset ?? DEFAULT_FONT_SUBSET;
    const axes = definition.axes ?? {};
    const identity = digestJson({
      kind: "vext-local-font-v1",
      source: createSha256(sourceBuffer),
      family: definition.family,
      weight: String(definition.weight ?? "400"),
      style: definition.style ?? "normal",
      display: definition.display ?? "swap",
      subset,
      unicodeRange: definition.unicodeRange,
      axes,
      license: definition.license,
    });
    if (emitted.has(identity)) continue;
    let output: Buffer;
    try {
      output = await subsetFont(sourceBuffer, subset, {
        targetFormat: "woff2",
        variationAxes: axes,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `[vextjs] defineFont() could not subset ${toProjectRelative(config.root, sourcePath)}: ${reason}`,
      );
    }
    if (output.byteLength > config.media.fonts.maxBytes) {
      throw new Error(
        `[vextjs] local font "${definition.family}" output (${output.byteLength} bytes) exceeds config.frontend.media.fonts.maxBytes (${config.media.fonts.maxBytes} bytes).`,
      );
    }
    const outputName = `font-${identity.slice(0, 24)}.woff2`;
    const stagePath = path.join(stageDir, outputName);
    await writeFile(stagePath, output);
    const file = path.posix.join(
      config.build.client.assetsDir,
      "media",
      outputName,
    );
    const fallback = normalizeFallback(definition.fallback);
    const font: VextFrontendMediaFont = {
      id: identity,
      source: toProjectRelative(config.root, sourcePath),
      file,
      src: joinAssetBase(config, file),
      family: definition.family,
      weight: String(definition.weight ?? "400"),
      style: definition.style ?? "normal",
      display: definition.display ?? "swap",
      preload: definition.preload ?? false,
      fallback,
      subset,
      unicodeRange: definition.unicodeRange,
      axes,
      license: definition.license,
      bytes: output.byteLength,
      sha256: createSha256(output),
      integrity: createSriSha256(output),
      contentType: "font/woff2",
    };
    staged.push({ file, stagePath, bytes: output.byteLength });
    emitted.set(identity, font);
  }
  return [...emitted.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

async function scanFontDefinitions(
  config: ResolvedVextFrontendConfig,
): Promise<ParsedFontDefinition[]> {
  if (!existsSync(config.root)) return [];
  const files = await fg(SOURCE_GLOB, {
    cwd: config.root,
    absolute: true,
    onlyFiles: true,
    ignore: ["assets/**"],
  });
  const definitions: ParsedFontDefinition[] = [];
  for (const file of files.sort((left, right) => left.localeCompare(right))) {
    const content = await readFile(file, "utf-8");
    for (const value of readDefineFontLiterals(content, file)) {
      definitions.push(parseFontDefinition(value, file));
    }
  }
  return definitions;
}

function parseFontDefinition(
  value: unknown,
  definitionFile: string,
): ParsedFontDefinition {
  if (!isRecord(value)) {
    throw new Error(
      `[vextjs] defineFont() descriptor in ${definitionFile} must be a static object literal.`,
    );
  }
  const src = readRequiredString(value, "src", definitionFile);
  const family = readRequiredString(value, "family", definitionFile);
  const license = readRequiredString(value, "license", definitionFile);
  const weight = readOptionalStringOrNumber(value, "weight", definitionFile);
  const style = readOptionalString(value, "style", definitionFile);
  const display = readOptionalDisplay(value, definitionFile);
  const subset = readOptionalString(value, "subset", definitionFile);
  const unicodeRange = readOptionalString(
    value,
    "unicodeRange",
    definitionFile,
  );
  const preload = readOptionalBoolean(value, "preload", definitionFile);
  const fallback = readFallback(value.fallback, definitionFile);
  const axes = readAxes(value.axes, definitionFile);
  return {
    definitionFile,
    src,
    family,
    license,
    weight,
    style,
    display,
    subset,
    unicodeRange,
    preload,
    fallback,
    axes,
  };
}

function readDefineFontLiterals(content: string, file: string): unknown[] {
  const result: unknown[] = [];
  const start = /\bdefineFont\s*\(\s*\{/gu;
  let match: RegExpExecArray | null;
  while ((match = start.exec(content))) {
    const objectStart = content.indexOf("{", match.index);
    const objectLiteral = readBalancedObject(content, objectStart, file);
    result.push(new StaticLiteralParser(objectLiteral, file).parse());
    start.lastIndex = objectStart + objectLiteral.length;
  }
  return result;
}

function readBalancedObject(
  source: string,
  start: number,
  file: string,
): string {
  let depth = 0;
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`[vextjs] defineFont() object in ${file} is not closed.`);
}

class StaticLiteralParser {
  private index = 0;

  constructor(
    private readonly source: string,
    private readonly file: string,
  ) {}

  parse(): unknown {
    const value = this.readValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) this.fail("contains trailing code");
    return value;
  }

  private readValue(): unknown {
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === "{") return this.readObject();
    if (character === "[") return this.readArray();
    if (character === "'" || character === '"') return this.readString();
    if (this.startsWith("true")) return this.readKeyword("true", true);
    if (this.startsWith("false")) return this.readKeyword("false", false);
    if (this.startsWith("null")) return this.readKeyword("null", null);
    if (character && /[-0-9]/u.test(character)) return this.readNumber();
    this.fail("must use static strings, booleans, numbers, arrays, or objects");
  }

  private readObject(): Record<string, unknown> {
    const value: Record<string, unknown> = {};
    this.expect("{");
    this.skipWhitespace();
    while (this.source[this.index] !== "}") {
      const key = this.readKey();
      this.skipWhitespace();
      this.expect(":");
      value[key] = this.readValue();
      this.skipWhitespace();
      if (this.source[this.index] === ",") {
        this.index += 1;
        this.skipWhitespace();
        continue;
      }
      if (this.source[this.index] !== "}")
        this.fail("expects a comma or closing brace");
    }
    this.index += 1;
    return value;
  }

  private readArray(): unknown[] {
    const value: unknown[] = [];
    this.expect("[");
    this.skipWhitespace();
    while (this.source[this.index] !== "]") {
      value.push(this.readValue());
      this.skipWhitespace();
      if (this.source[this.index] === ",") {
        this.index += 1;
        this.skipWhitespace();
        continue;
      }
      if (this.source[this.index] !== "]")
        this.fail("expects a comma or closing bracket");
    }
    this.index += 1;
    return value;
  }

  private readKey(): string {
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === "'" || character === '"') return this.readString();
    const match = /^[A-Za-z_$][\w$]*/u.exec(this.source.slice(this.index));
    if (!match) this.fail("expects a static property name");
    this.index += match[0].length;
    return match[0];
  }

  private readString(): string {
    const quote = this.source[this.index];
    if (quote !== "'" && quote !== '"') this.fail("expects a string");
    this.index += 1;
    let output = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index++]!;
      if (character === quote) return output;
      if (character !== "\\") {
        output += character;
        continue;
      }
      const escaped = this.source[this.index++];
      if (!escaped) this.fail("contains an unfinished escape sequence");
      const escapes: Record<string, string> = {
        "\\": "\\",
        "'": "'",
        '"': '"',
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
      };
      if (escaped === "u") {
        const code = this.source.slice(this.index, this.index + 4);
        if (!/^[0-9a-f]{4}$/iu.test(code))
          this.fail("contains an invalid unicode escape");
        output += String.fromCharCode(Number.parseInt(code, 16));
        this.index += 4;
      } else {
        output += escapes[escaped] ?? escaped;
      }
    }
    this.fail("contains an unterminated string");
  }

  private readKeyword(keyword: string, value: boolean | null): boolean | null {
    this.index += keyword.length;
    return value;
  }

  private readNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.source.slice(this.index),
    );
    if (!match) this.fail("contains an invalid number");
    this.index += match[0].length;
    return Number(match[0]);
  }

  private startsWith(value: string): boolean {
    return this.source.slice(this.index, this.index + value.length) === value;
  }

  private expect(value: string): void {
    this.skipWhitespace();
    if (this.source[this.index] !== value) this.fail(`expects "${value}"`);
    this.index += 1;
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.source[this.index] ?? "")) this.index += 1;
  }

  private fail(reason: string): never {
    throw new Error(
      `[vextjs] defineFont() descriptor in ${this.file} ${reason}; dynamic expressions are not supported by the local media compiler.`,
    );
  }
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
  file: string,
): string {
  const result = readOptionalString(value, key, file);
  if (!result?.trim()) {
    throw new Error(
      `[vextjs] defineFont() descriptor in ${file} requires "${key}".`,
    );
  }
  return result;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  file: string,
): string | undefined {
  const result = value[key];
  if (result === undefined) return undefined;
  if (typeof result !== "string") {
    throw new Error(
      `[vextjs] defineFont() descriptor in ${file} expects "${key}" to be a string.`,
    );
  }
  return result;
}

function readOptionalStringOrNumber(
  value: Record<string, unknown>,
  key: string,
  file: string,
): string | number | undefined {
  const result = value[key];
  if (
    result === undefined ||
    typeof result === "string" ||
    typeof result === "number"
  )
    return result;
  throw new Error(
    `[vextjs] defineFont() descriptor in ${file} expects "${key}" to be a string or number.`,
  );
}

function readOptionalDisplay(
  value: Record<string, unknown>,
  file: string,
): VextFontDefinition["display"] {
  const display = readOptionalString(value, "display", file);
  if (
    display === undefined ||
    display === "auto" ||
    display === "block" ||
    display === "swap" ||
    display === "fallback" ||
    display === "optional"
  ) {
    return display;
  }
  throw new Error(
    `[vextjs] defineFont() descriptor in ${file} has an invalid display value.`,
  );
}

function readOptionalBoolean(
  value: Record<string, unknown>,
  key: string,
  file: string,
): boolean | undefined {
  const result = value[key];
  if (result === undefined || typeof result === "boolean") return result;
  throw new Error(
    `[vextjs] defineFont() descriptor in ${file} expects "${key}" to be a boolean.`,
  );
}

function readFallback(
  value: unknown,
  file: string,
): VextFontDefinition["fallback"] {
  if (value === undefined || typeof value === "string") return value;
  if (!isRecord(value) || typeof value.family !== "string") {
    throw new Error(
      `[vextjs] defineFont() descriptor in ${file} has an invalid fallback.`,
    );
  }
  return {
    family: value.family,
    sizeAdjust: optionalMetric(value.sizeAdjust, "fallback.sizeAdjust", file),
    ascentOverride: optionalMetric(
      value.ascentOverride,
      "fallback.ascentOverride",
      file,
    ),
    descentOverride: optionalMetric(
      value.descentOverride,
      "fallback.descentOverride",
      file,
    ),
    lineGapOverride: optionalMetric(
      value.lineGapOverride,
      "fallback.lineGapOverride",
      file,
    ),
  };
}

function optionalMetric(
  value: unknown,
  label: string,
  file: string,
): string | undefined {
  if (value === undefined || typeof value === "string") return value;
  throw new Error(
    `[vextjs] defineFont() descriptor in ${file} expects "${label}" to be a string.`,
  );
}

function readAxes(
  value: unknown,
  file: string,
): Record<string, VextFontVariationAxis> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(
      `[vextjs] defineFont() descriptor in ${file} expects "axes" to be an object.`,
    );
  }
  const axes: Record<string, VextFontVariationAxis> = {};
  for (const [axis, axisValue] of Object.entries(value)) {
    if (typeof axisValue === "number") {
      axes[axis] = axisValue;
      continue;
    }
    if (!isRecord(axisValue)) {
      throw new Error(
        `[vextjs] defineFont() descriptor in ${file} has an invalid axis "${axis}".`,
      );
    }
    const range: { min?: number; max?: number; default?: number } = {};
    for (const key of ["min", "max", "default"] as const) {
      const number = axisValue[key];
      if (number === undefined) continue;
      if (typeof number !== "number") {
        throw new Error(
          `[vextjs] defineFont() descriptor in ${file} has an invalid axis ${axis}.${key}.`,
        );
      }
      range[key] = number;
    }
    axes[axis] = range;
  }
  return axes;
}

function resolveOriginalFormat(
  metadataFormat: string | undefined,
  filePath: string,
): VextMediaRasterFormat {
  if (
    metadataFormat === "jpeg" ||
    metadataFormat === "png" ||
    metadataFormat === "webp" ||
    metadataFormat === "avif"
  ) {
    return metadataFormat;
  }
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  if (extension === ".png") return "png";
  if (extension === ".webp") return "webp";
  if (extension === ".avif") return "avif";
  throw new Error(`[vextjs] unsupported local image codec for ${filePath}.`);
}

function createImagePlaceholder(width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f3f4f6"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function compareVariant(
  left: VextFrontendMediaVariant,
  right: VextFrontendMediaVariant,
): number {
  return left.width - right.width || left.format.localeCompare(right.format);
}

function joinAssetBase(
  config: ResolvedVextFrontendConfig,
  file: string,
): string {
  return `${getAssetBase(config)}${file.replace(/^\/+/, "")}`;
}

function getAssetBase(config: ResolvedVextFrontendConfig): string {
  return config.deploy.assetBaseUrl ?? config.publicPath;
}

function resolveDescriptorLocalPath(
  root: string,
  file: string,
  source: string,
): string {
  const resolved = path.resolve(path.dirname(file), source);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      "[vextjs] defineFont() local source must remain inside config.frontend.root.",
    );
  }
  return resolved;
}

function toProjectRelative(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/gu, "/");
}

function isRemoteSource(value: string): boolean {
  return /^https?:\/\//iu.test(value.trim());
}

function digestJson(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
