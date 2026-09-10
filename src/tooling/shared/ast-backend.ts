export async function loadAstBackend(): Promise<
  typeof import("../../lib/source-syntax.js")
> {
  return import("../../lib/source-syntax.js");
}
