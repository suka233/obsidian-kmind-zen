/**
 * History thumbnails: a `.preview.svg` next to a history entry, for the history panel only.
 * JSON and Yjs snapshots have had one for long; package checkpoints get one since phase-25.7,
 * when map files stopped carrying a rendered preview. A package entry without one (written
 * earlier, by 0.34.0, or the external side of a conflict) still shows its own preview slot.
 */
const HISTORY_ENTRY_EXTENSION = /\.(?:yjs|kmindz-docs\.json|kmindz\.svg)$/iu;

/** The thumbnail next to a history entry, or null for a file that is not a history entry. */
export function resolveHistoryThumbnailPath(entryPath: string): string | null {
  return HISTORY_ENTRY_EXTENSION.test(entryPath) ? entryPath.replace(HISTORY_ENTRY_EXTENSION, ".preview.svg") : null;
}

/** Where the history panel looks for an entry's picture, first existing one wins. */
export function historyThumbnailSources(entryPath: string): string[] {
  const thumbnail = resolveHistoryThumbnailPath(entryPath);
  if (!thumbnail) return [];
  return /\.kmindz\.svg$/iu.test(entryPath) ? [thumbnail, entryPath] : [thumbnail];
}
