import { projectProtectionError } from "@kmind/app";
import type { App, TFile } from "obsidian";
import { readOwnedProjectSaveTransaction, retireCompletedProjectTransaction, sha256HexText, type ProjectDurableDescriptor, type ProjectSafetyMaintenanceWarning } from "@kmind/app";
import { removeObsidianEmptySafetyDirectory, resolveObsidianSafetyDirectory, resolveObsidianRetryArchiveDirectory } from "./obsidian-safe-project-write";

/** Unknown maintenance evidence never determines whether the verified main file is valid. */
export async function cleanupObsidianCompletedTransactions(args: {
  app: App; file: TFile; currentText: string; descriptor: ProjectDurableDescriptor;
  inspectSource(text: string): Promise<ProjectDurableDescriptor>;
  deferBeforeWrite?(task: () => Promise<void>): void;
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
  try {
    if (!await adapter.exists(root)) { await assertCurrent(); return null; }
    const listing = await adapter.list(root);
    count += listing.files.length;
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
        if (journal.candidateFingerprint !== args.descriptor.fullFileFingerprint) { conflict = true; continue; }
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
