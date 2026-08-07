declare module "subset-font" {
  export interface SubsetFontVariationAxisRange {
    min?: number;
    max?: number;
    default?: number;
  }

  export interface SubsetFontOptions {
    targetFormat?: "sfnt" | "truetype" | "woff" | "woff2";
    preserveNameIds?: number[];
    variationAxes?: Record<string, number | SubsetFontVariationAxisRange>;
    noLayoutClosure?: boolean;
  }

  export default function subsetFont(
    source: Buffer,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Buffer>;
}
