export function markUniqueOption(seen: Set<string>, option: string): void {
  if (seen.has(option)) {
    console.error(`[vextjs] ${option} may only be specified once`);
    process.exit(1);
  }
  seen.add(option);
}
