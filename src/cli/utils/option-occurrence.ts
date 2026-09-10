export function assertUniqueOption(seen: Set<string>, option: string): void {
  if (seen.has(option)) {
    throw new Error(`[vextjs] ${option} may only be specified once`);
  }
  seen.add(option);
}

export function markUniqueOption(seen: Set<string>, option: string): void {
  try {
    assertUniqueOption(seen, option);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
