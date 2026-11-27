import type { TFile } from "obsidian";

// Panes and pop-out windows of a vault share this JS environment, so the file object keys the
// exact bytes this device's editing view is writing and last wrote to it. A read-only view adopts
// those bytes as written: the editing view already verified the change (destructive proof, safety
// checkpoint). The bytes are recorded before the write, so a read-only view that reads them before
// the editing view finishes verifying already knows them; a write that never lands never matches.
const trustedByFile = new WeakMap<TFile, { writing: string | null; written: string | null }>();

function trusted(file: TFile): { writing: string | null; written: string | null } {
  let entry = trustedByFile.get(file);
  if (!entry) trustedByFile.set(file, entry = { writing: null, written: null });
  return entry;
}

/** Before the editing view writes the file. */
export function recordObsidianEditorWriteIntent(file: TFile, fullFileFingerprint: string): void {
  trusted(file).writing = fullFileFingerprint;
}

/** After the editing view verified its write (or adopted a committed retry candidate). */
export function recordObsidianEditorWrite(file: TFile, fullFileFingerprint: string): void {
  trusted(file).written = fullFileFingerprint;
}

export function isObsidianEditorWrite(file: TFile, fullFileFingerprint: string): boolean {
  const entry = trustedByFile.get(file);
  return entry !== undefined && (entry.writing === fullFileFingerprint || entry.written === fullFileFingerprint);
}
