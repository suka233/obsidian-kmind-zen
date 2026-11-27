import { acquireProjectEditLock, type ProjectEditLock, type ProjectEditLockManager } from "@kmind/app";
import type { TFile } from "obsidian";

// Obsidian keeps one TFile per vault file across panes, pop-out windows and renames, and
// copies are distinct objects: its identity is the file the lock stands for.
const lockIdByFile = new WeakMap<TFile, string>();

function editLockName(file: TFile): string {
  let id = lockIdByFile.get(file);
  if (!id) lockIdByFile.set(file, id = globalThis.crypto.randomUUID());
  return `kmind-zen:edit:${id}`;
}

export type ObsidianEditLease = ProjectEditLock;

/** One editor per file on this device (the shared project edit lock, keyed by the file object). */
export async function acquireObsidianEditLease(
  file: TFile,
  locks: ProjectEditLockManager | undefined = globalThis.navigator?.locks,
): Promise<ObsidianEditLease> {
  return acquireProjectEditLock(editLockName(file), locks);
}
