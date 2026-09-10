/** 前后端共享的纯消息投影；此模块不读取文件，也不依赖 schema-dsl。 */
export interface LocaleMessageSource {
  locale: string;
  namespace: string;
  file: string;
  messages: unknown;
}

export type LocaleMessages = Record<string, Record<string, unknown>>;

/** 后端使用扁平键；前端保留对象访问。两者共享来源和最终键的冲突检查。 */
export function projectLocaleMessages(
  sources: LocaleMessageSource[],
  shape: "flat" | "nested" = "flat",
): LocaleMessages {
  const result: LocaleMessages = Object.create(null);
  const owners = new Map<string, string>();
  const branches = new Set<object>();
  for (const source of sources) {
    const messages = (result[source.locale] ??= Object.create(null));
    const visiting = new Set<object>();
    const assign = (segments: string[], value: unknown): void => {
      let parent = messages;
      for (const segment of segments.slice(0, -1)) {
        if (!Object.hasOwn(parent, segment)) {
          const branch: Record<string, unknown> = Object.create(null);
          branches.add(branch);
          parent[segment] = branch;
        }
        const branch = parent[segment];
        if (!branch || typeof branch !== "object" || !branches.has(branch))
          throw new Error(
            `[vextjs] Locale leaf conflicts with a namespace: ${source.file} (${segments.join(".")})`,
          );
        parent = branch as Record<string, unknown>;
      }
      const key = segments.at(-1)!;
      if (Object.hasOwn(parent, key))
        throw new Error(
          `[vextjs] Locale leaf conflicts with a namespace: ${source.file} (${segments.join(".")})`,
        );
      parent[key] = value;
    };
    const visit = (
      value: unknown,
      prefix: string,
      depth: number,
      segments: string[],
    ): void => {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        visiting.has(value)
      ) {
        throw new Error(
          `[vextjs] Invalid locale dictionary: ${source.file} (${prefix})`,
        );
      }
      visiting.add(value);
      for (const rawKey of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, rawKey)!;
        if (!Object.hasOwn(descriptor, "value"))
          throw new Error(
            `[vextjs] Locale getters are unsupported: ${source.file} (${rawKey})`,
          );
        const item: unknown = descriptor.value;
        const key = rawKey.normalize("NFC");
        if (!key || ["__proto__", "prototype", "constructor"].includes(key)) {
          throw new Error(
            `[vextjs] Invalid locale key: ${source.file} (${rawKey})`,
          );
        }
        const qualified =
          depth === 0 && (key.includes(".") || /^\d+$/.test(key));
        const fullKey = qualified || !prefix ? key : `${prefix}.${key}`;
        const outputSegments = qualified ? [key] : [...segments, key];
        const leaf =
          typeof item === "string" ||
          (item !== null &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof Object.getOwnPropertyDescriptor(item, "message")?.value ===
              "string");
        if (!leaf) {
          visit(item, fullKey, depth + 1, outputSegments);
          continue;
        }
        const identity = `${source.locale}\0${fullKey}`;
        const previous = owners.get(identity);
        if (previous)
          throw new Error(
            `[vextjs] Duplicate locale key ${source.locale}:${fullKey}: ${previous} and ${source.file}`,
          );
        owners.set(identity, source.file);
        if (typeof item !== "string")
          assertNoAccessors(item, source.file, fullKey);
        const copied = typeof item === "string" ? item : structuredClone(item);
        if (shape === "nested") assign(outputSegments, copied);
        else messages[fullKey] = copied;
      }
      visiting.delete(value);
    };
    visit(
      source.messages,
      source.namespace,
      0,
      source.namespace ? source.namespace.split(".") : [],
    );
  }
  return result;
}

function assertNoAccessors(
  value: object,
  file: string,
  key: string,
  seen = new Set<object>(),
): void {
  if (seen.has(value))
    throw new Error(`[vextjs] Invalid locale dictionary: ${file} (${key})`);
  seen.add(value);
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!Object.hasOwn(descriptor, "value"))
      throw new Error(
        `[vextjs] Locale getters are unsupported: ${file} (${key})`,
      );
    if (descriptor.value && typeof descriptor.value === "object")
      assertNoAccessors(descriptor.value, file, key, seen);
  }
  seen.delete(value);
}
