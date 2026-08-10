export const OBSIDIAN_KMIND_STORAGE_PREFIX = "kmind-zen:";

export function buildObsidianKmindStorageKey(
  key: string,
  prefix = OBSIDIAN_KMIND_STORAGE_PREFIX,
): string {
  return `${prefix}${key}`;
}
