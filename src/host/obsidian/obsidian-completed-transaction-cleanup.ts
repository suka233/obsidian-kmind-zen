import { projectProtectionError } from "@kmind/app";
import type { App, TFile } from "obsidian";
import { readOwnedProjectSaveTransaction, retireCompletedProjectTransaction, sha256HexText, type ProjectDurableDescriptor, type ProjectSafetyMaintenanceWarning } from "@kmind/app";
import { parseObsidianSafetyCopyFileName, removeObsidianEmptySafetyDirectory, resolveObsidianSafetyDirectory, resolveObsidianRetryArchiveDirectory, retireObsidianSaveAttempt } from "./obsidian-safe-project-write";

/**
 * What a file's safety directory holds when it is opened, taken over or adopted. Unknown
 * maintenance evidence never determines whether the verified main file is valid. Opening never
 * writes: what must be stored or archived waits for the next write (`settleBeforeWrite`).
 *
 * Crash copies (phase-25.8, `<attempt id>.<candidate SHA-256>.kmindz`):
 * - the file holds the copy's candidate: committed, the copy is redundant and is removed;
 * - the copy is partial (its content is not its name's candidate): nothing to keep, removed;
 * - a complete copy of another version (a crash before the file was written, or the file was
 *   replaced since): stored with the conflicts as the local side before the next write, then
 *   removed; one that cannot be stored stays in place as retained evidence.
 *
 * Attempt directories of earlier versions (`transaction.json` and `source.kmindz.svg`):
 * - committed: retired as before;
 * - the file is still the attempt's source (never committed: nothing is at risk) or holds another
 *   writer's verified version (superseded by a sync tool): moved to the retry archive before the
 *   next write;
 * - anything else protects.
 */
export async function cleanupObsidianCompletedTransactions(args: {
  app: App; file: TFile; currentText: string; descriptor: ProjectDurableDescriptor;
  inspectSource(text: string): Promise<ProjectDurableDescriptor>;
  /**
   * Checks that a complete crash copy of another version can be stored with the conflicts (local
   * side) and returns the task that stores it; throws when it cannot be stored.
   */
  prepareSupersededCopy(copyText: string, rootDocId: string): Promise<() => Promise<void>>;
  deferBeforeWrite?(task: () => Promise<void>): void;
  settleBeforeWrite?(task: () => Promise<void>): void;
  inspectOnly?: boolean | undefined;
}): Promise<ProjectSafetyMaintenanceWarning | null> {
  const target = args.file.path, adapter = args.app.vault.adapter;
  const root = await resolveObsidianSafetyDirectory(target);
  const assertCurrent = async () => {
    if (args.file.path !== target || await args.app.vault.read(args.file) !== args.currentText || args.file.path !== target) {
      throw projectProtectionError("external-changed", "Project changed during completed transaction maintenance; evidence retained.");
    }
  };
  let count = 0;
  let conflict = false;
  const cleanups: (() => Promise<void>)[] = [];
  const retirements: (() => Promise<void>)[] = [];
  const superseded: (() => Promise<void>)[] = [];
  /** A redundant copy: removed now when opening, before the next write when inspecting only. */
  const discard = (task: () => Promise<void>) => { (args.inspectOnly ? superseded : cleanups).push(task); };
  try {
    // Nothing to maintain, so nothing to check the file against (phase-25.9: opening reads it once).
    if (!await adapter.exists(root)) return null;
    const listing = await adapter.list(root);
    if (!listing.files.length && !listing.folders.length) return null;
    for (const path of listing.files) {
      const copy = path.startsWith(`${root}/`) ? parseObsidianSafetyCopyFileName(path.slice(root.length + 1)) : null;
      if (!copy) { count++; continue; }
      try {
        if (copy.candidateFingerprint === args.descriptor.fullFileFingerprint) {
          discard(async () => { if (await adapter.exists(path)) await adapter.remove(path); });
          continue;
        }
        const copyText = await adapter.read(path);
        const removeUnchanged = async () => {
          if (await adapter.read(path) !== copyText) throw Error("Safety copy changed; evidence retained.");
          await adapter.remove(path);
        };
        if (await sha256HexText(copyText) !== copy.candidateFingerprint) {
          discard(async () => { if (await adapter.exists(path)) await removeUnchanged(); });
          continue;
        }
        let preserve: () => Promise<void>;
        try { preserve = await args.prepareSupersededCopy(copyText, args.descriptor.rootDocId); } catch { count++; continue; }
        superseded.push(async () => {
          // Stored and removed elsewhere (another pane) once it is gone.
          if (!await adapter.exists(path)) return;
          if (await adapter.read(path) !== copyText) throw Error("Safety copy changed; evidence retained.");
          await preserve();
          await removeUnchanged();
        });
      } catch { count++; }
    }
    for (const directory of listing.folders) {
      const id = directory.slice(root.length + 1);
      if (!directory.startsWith(`${root}/`) || !/^[a-zA-Z0-9_-]+$/u.test(id)) { count++; continue; }
      try {
        const journalPath = `${directory}/transaction.json`, sourcePath = `${directory}/source.kmindz.svg`;
        const entries = await adapter.list(directory);
        if (!entries.files.length && !entries.folders.length) {
          cleanups.push(async () => { await assertCurrent(); await removeObsidianEmptySafetyDirectory(adapter, directory); });
          continue;
        }
        const stat = await adapter.stat(journalPath);
        if (!stat || stat.type !== "file" || stat.size > 4096) { count++; continue; }
        const journalText = await adapter.read(journalPath);
        const journal = readOwnedProjectSaveTransaction({ text: journalText, transactionId: id, projectId: args.descriptor.rootDocId, targetKey: target });
        if (!journal) { count++; continue; }
        if (journal.candidateFingerprint !== args.descriptor.fullFileFingerprint) {
          // Only the attempt's own files may move; anything else protects.
          if (entries.folders.length || entries.files.some(path => path !== journalPath && path !== sourcePath)) { conflict = true; continue; }
          const sourceText = entries.files.includes(sourcePath) ? await adapter.read(sourcePath) : null;
          // Never committed (phase-25.8): the file is still the attempt's source, so its copy, whatever
          // state the crash left it in, holds nothing the file does not.
          if (journal.sourceFingerprint !== args.descriptor.fullFileFingerprint) {
            // Superseded: the source copy must be the attempt's own, verified one.
            if (sourceText !== null) {
              if (await sha256HexText(sourceText) !== journal.sourceFingerprint) { conflict = true; continue; }
              let sourceDescriptor: ProjectDurableDescriptor;
              try { sourceDescriptor = await args.inspectSource(sourceText); } catch { conflict = true; continue; }
              if (sourceDescriptor.rootDocId !== journal.projectId || sourceDescriptor.consistency === "invalid") { conflict = true; continue; }
            }
          }
          superseded.push(async () => {
            // Retired elsewhere (another pane or device) once its journal is gone.
            if (!await adapter.exists(journalPath)) return;
            if (await adapter.read(journalPath) !== journalText) throw Error("Unfinished save journal changed; evidence retained.");
            await retireObsidianSaveAttempt({ adapter, targetPath: target, transactionId: id, files: { source: sourceText, journal: journalText } });
            await removeObsidianEmptySafetyDirectory(adapter, directory);
          });
          continue;
        }
        let verifiedSourceText: string | null = null;
        retirements.push(async () => {
          if (!await adapter.exists(journalPath)) return;
          const archive = `${await resolveObsidianRetryArchiveDirectory(target)}/${id}`;
          await retireCompletedProjectTransaction({
            currentText: args.currentText, journalText, journalPath,
            archiveJournalPath: `${archive}/transaction.json`, archiveCandidatePath: `${archive}/candidate.kmindz.svg`,
            ...(verifiedSourceText !== null ? { verifiedSource: { text: verifiedSourceText, archivePath: `${archive}/source.kmindz.svg` } } : {}),
            readCurrent: async () => { await assertCurrent(); return args.currentText; },
            read: async path => await adapter.exists(path) ? adapter.read(path) : null,
            write: async (path, text) => {
              let parent = "";
              for (const segment of path.split("/").slice(0, -1)) {
                parent = parent ? `${parent}/${segment}` : segment;
                if (!await adapter.exists(parent)) await adapter.mkdir(parent);
              }
              await adapter.write(path, text);
            },
            remove: path => adapter.remove(path),
          });
        });
        const sourceText = entries.files.includes(sourcePath) ? await adapter.read(sourcePath) : null;
        if (sourceText !== null) {
          if (await sha256HexText(sourceText) !== journal.sourceFingerprint) { count++; continue; }
          const sourceDescriptor = await args.inspectSource(sourceText);
          if (sourceDescriptor.rootDocId !== journal.projectId || sourceDescriptor.consistency === "invalid") { count++; continue; }
          verifiedSourceText = sourceText;
        }
        if (entries.folders.length || entries.files.some(path => path !== journalPath && path !== sourcePath)) { count++; continue; }
        cleanups.push(async () => {
          const assertJournal = async () => {
            await assertCurrent();
            if (await adapter.read(journalPath) !== journalText) throw Error("Safety journal changed; evidence retained.");
          };
          if (sourceText !== null) {
            if (await adapter.read(sourcePath) !== sourceText) throw Error("Safety source changed; evidence retained.");
            await assertJournal();
            await adapter.remove(sourcePath);
          }
          await assertJournal();
          if (await adapter.exists(sourcePath)) throw Error("Safety source appeared during cleanup; journal retained.");
          await adapter.remove(journalPath);
          await removeObsidianEmptySafetyDirectory(adapter, directory);
        });
      } catch { count++; }
    }
  } catch { count++; }
  await assertCurrent();
  if (conflict) throw projectProtectionError("transaction-conflict", "Unfinished or conflicting project save transaction; sources preserved for recovery.");
  // Opening never writes: what must be stored or archived waits for the next write.
  for (const settle of superseded) args.settleBeforeWrite?.(settle);
  if (args.inspectOnly) {
    // Hand over closures, not writes: explicit adoption can retire these exact
    // completed records before its first later save.
    for (const retire of retirements) args.deferBeforeWrite?.(retire);
    return count ? Object.freeze({ code: "sources-retained", count }) : null;
  }
  // Preflight all records before any deletion. Unknown sources stop this sweep.
  if (!count) for (const cleanup of cleanups) {
    try { await cleanup(); } catch { count++; break; }
  }
  await assertCurrent();
  if (count) for (const retire of retirements) {
    try { await retire(); } catch { args.deferBeforeWrite?.(retire); }
  }
  await assertCurrent();
  return count ? Object.freeze({ code: "sources-retained", count }) : null;
}
