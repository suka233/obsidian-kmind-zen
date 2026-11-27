import type { App } from "obsidian";
import type { DocumentId, ProjectHistoryEntry } from "@kmind/app";
import { parseHistoryCheckpointFileName, planProjectHistoryRetention, type ProjectHistorySafetyTag } from "@kmind/host-local";

import { isObsidianHistoryFileProtected } from "./obsidian-history-restore-lease";
import { resolveHistoryThumbnailPath } from "./obsidian-history-thumbnails";

export type ObsidianHistoryRetentionRule =
  /** Automatic snapshots beyond `autoKeep` (both formats together). */
  | Readonly<{ mode: "auto"; autoKeep: number }>
  /** Safety snapshots of one kind beyond ten; `protectedPaths` (e.g. the one just written) stay. */
  | Readonly<{ mode: "safety"; safetyTag: ProjectHistorySafetyTag; protectedPaths?: readonly string[] | undefined }>;

const normalizeVaultPath = (path: string): string => String(path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");

/** Files that belong to a snapshot: its thumbnail (packages too, since phase-25.7), the metadata of an old Yjs one. */
const companionPaths = (path: string): string[] => {
  const thumbnail = resolveHistoryThumbnailPath(path);
  return [
    ...(thumbnail ? [thumbnail] : []),
    ...(/\.yjs$/iu.test(path) ? [path.replace(/\.yjs$/iu, ".meta.json")] : []),
  ];
};

/**
 * Applies the plugins' history retention rule (`planProjectHistoryRetention`) to a project's
 * checkpoints and returns the deleted paths. Manual checkpoints, migration backups and conflict
 * snapshots are never deleted; neither is a snapshot an in-progress restore holds.
 */
export async function applyObsidianHistoryRetention(
  app: Pick<App, "vault">,
  rootDocId: DocumentId,
  rule: ObsidianHistoryRetentionRule,
): Promise<string[]> {
  const dir = normalizeVaultPath(`.kmind-zen/projects/${rootDocId}/history/checkpoints`);
  if (!await app.vault.adapter.exists(dir)) return [];
  const entries: ProjectHistoryEntry[] = [];
  for (const listed of (await app.vault.adapter.list(dir)).files ?? []) {
    const path = normalizeVaultPath(listed);
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const parsed = parseHistoryCheckpointFileName(fileName);
    if (parsed.ts === null || parsed.storageFormat === "unknown") continue;
    entries.push({
      id: path, kind: "checkpoint", fileName, ts: parsed.ts, device: parsed.deviceId, tag: parsed.tag,
      label: parsed.legacyLabel, pinned: parsed.pinned, name: parsed.name, storageFormat: parsed.storageFormat, previewAvailable: false,
    });
  }
  const leasedEntryIds = new Set(entries.filter((entry) => isObsidianHistoryFileProtected(app as App, entry.id)).map((entry) => entry.id));
  const plan = rule.mode === "auto"
    ? planProjectHistoryRetention({ entries, mode: "auto", autoKeep: rule.autoKeep, leasedEntryIds })
    : planProjectHistoryRetention({ entries, mode: "safety", safetyTag: rule.safetyTag, leasedEntryIds,
      protectedEntryIds: new Set((rule.protectedPaths ?? []).map(normalizeVaultPath)) });
  for (const path of plan.deletedEntryIds) {
    await app.vault.adapter.remove(path);
    for (const companion of companionPaths(path)) {
      if (await app.vault.adapter.exists(companion)) await app.vault.adapter.remove(companion);
    }
  }
  return plan.deletedEntryIds;
}
