import type {
  AppExtensionIndexEntry,
  ExtensionSourceKind,
  InferenceConfidence,
} from "../project-index/index.js";

export interface MergedAppExtensionEntry {
  propertyKey: string;
  inferredTypeText: string;
  pluginFiles: string[];
  sourceKinds: ExtensionSourceKind[];
  confidence: InferenceConfidence;
  conflict: boolean;
}

export interface MergeAppExtensionsResult {
  entries: MergedAppExtensionEntry[];
  warnings: string[];
}

export function mergeAppExtensions(
  entries: AppExtensionIndexEntry[],
): MergeAppExtensionsResult {
  const warnings: string[] = [];
  const merged = new Map<string, MergedAppExtensionEntry>();

  for (const entry of entries) {
    const existing = merged.get(entry.propertyKey);
    if (!existing) {
      merged.set(entry.propertyKey, {
        propertyKey: entry.propertyKey,
        inferredTypeText: entry.inferredTypeText,
        pluginFiles: [entry.pluginFile],
        sourceKinds: [entry.sourceKind],
        confidence: entry.confidence,
        conflict: false,
      });
      continue;
    }

    existing.pluginFiles = sortUnique([...existing.pluginFiles, entry.pluginFile]);
    existing.sourceKinds = sortUnique([...existing.sourceKinds, entry.sourceKind]);
    existing.confidence = mergeConfidence(existing.confidence, entry.confidence);

    if (existing.inferredTypeText !== entry.inferredTypeText) {
      warnings.push(
        `Conflicting inferred types for app.extend("${entry.propertyKey}") in ${entry.pluginFile}; falling back to unknown.`,
      );
      existing.inferredTypeText = "unknown";
      existing.conflict = true;
      existing.confidence = "low";
    }
  }

  return {
    entries: [...merged.values()].sort((a, b) => a.propertyKey.localeCompare(b.propertyKey)),
    warnings,
  };
}

function mergeConfidence(
  left: InferenceConfidence,
  right: InferenceConfidence,
): InferenceConfidence {
  const rank: Record<InferenceConfidence, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  return rank[left] <= rank[right] ? left : right;
}

function sortUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

