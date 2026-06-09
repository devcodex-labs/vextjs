import { join } from "node:path";

export interface TypegenGeneratedPaths {
  hiddenTypesDir: string;
  servicesDts: string;
  appExtensionsDts: string;
  shimDts: string;
  serviceManifest: string;
}

export function getTypegenGeneratedPaths(
  rootDir: string,
): TypegenGeneratedPaths {
  const hiddenTypesDir = join(rootDir, ".vext", "types");
  return {
    hiddenTypesDir,
    servicesDts: join(hiddenTypesDir, "services.generated.d.ts"),
    appExtensionsDts: join(hiddenTypesDir, "app-extensions.generated.d.ts"),
    shimDts: join(rootDir, "src", "types", "generated", "index.d.ts"),
    serviceManifest: join(rootDir, ".vext", "manifest", "services.json"),
  };
}
