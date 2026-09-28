import type { App, TFile } from "obsidian";
import {
  encodeProjectSaveTransaction,
  parseKmindzProjectV3FromSvgText,
  sha256HexText,
  writeProjectTextAtRevisionWithProcess,
  ProjectSaveIOError,
  retireCompletedProjectTransaction,
  type ProjectSaveFailureStage,
} from "@kmind/app";

export async function resolveObsidianSafetyDirectory(targetPath: string): Promise<string> {
  return `.kmind-zen/safety/${await sha256HexText(targetPath)}`;
}

export async function resolveObsidianRetryArchiveDirectory(targetPath: string): Promise<string> {
  return `.kmind-zen/retry-archives/${await sha256HexText(targetPath)}`;
}

export async function removeObsidianEmptySafetyDirectory(adapter: App["vault"]["adapter"], directory: string): Promise<void> {
  if (!/^\.kmind-zen\/safety\/[a-f0-9]{64}\/[a-zA-Z0-9_-]+$/u.test(directory)) throw new Error("Invalid safety cleanup directory.");
  const entries = await adapter.list(directory);
  if (entries.files.length || entries.folders.length) throw new Error("Safety directory is not empty; preserve its occupants.");
  // FileSystemAdapter uses fs.rm: recursive=false rejects even an empty directory.
  // Only this exact, freshly checked empty attempt may use the directory API.
  await adapter.rmdir(directory, true);
}

export class ObsidianVerifiedSourceWriteError extends ProjectSaveIOError {
  constructor(cause: unknown, stage: ProjectSaveFailureStage = "commit-uncertain") {
    super(cause, stage, true);
    this.name = "ObsidianVerifiedSourceWriteError";
  }
}

/** Vault owns the actual replacement; never move the canonical file away. */
export async function writeObsidianProjectSafely(args: {
  app: App;
  file: TFile;
  sourceText: string;
  nextText: string;
  expectedRevision: string | null;
  onRetainedCompletedTransaction?: ((retire: () => Promise<void>) => void) | undefined;
}): Promise<void> {
  const source = parseKmindzProjectV3FromSvgText(args.sourceText);
  const candidate = parseKmindzProjectV3FromSvgText(args.nextText);
  if (!source || !candidate || source.header.rootDocId !== candidate.header.rootDocId) {
    throw new Error("Project safety write requires matching valid source and candidate packages.");
  }
  const targetPath = args.file.path;
  const adapter = args.app.vault.adapter;
  const transactionId = globalThis.crypto.randomUUID();
  const directory = `${await resolveObsidianSafetyDirectory(targetPath)}/${transactionId}`;
  const journalPath = `${directory}/transaction.json`;
  const sourcePath = `${directory}/source.kmindz.svg`;
  const journal = encodeProjectSaveTransaction({
    version: 1, kind: "project-save", transactionId,
    projectId: source.header.rootDocId, targetKey: targetPath,
    sourceFingerprint: await sha256HexText(args.sourceText),
    candidateFingerprint: await sha256HexText(args.nextText),
  });
  const retireCompleted = async () => {
    const archive = `${await resolveObsidianRetryArchiveDirectory(targetPath)}/${transactionId}`;
    await retireCompletedProjectTransaction({
      currentText: args.nextText, journalText: journal, journalPath,
      archiveJournalPath: `${archive}/transaction.json`, archiveCandidatePath: `${archive}/candidate.kmindz.svg`,
      verifiedSource: { text: args.sourceText, archivePath: `${archive}/source.kmindz.svg` },
      readCurrent: async () => {
        if (args.file.path !== targetPath) throw new Error("Project path changed before completed transaction retirement.");
        const text = await args.app.vault.read(args.file);
        if (args.file.path !== targetPath) throw new Error("Project path changed during completed transaction retirement.");
        return text;
      },
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
  };
  let commitStarted = false;
  let sourceVerified = false;
  try {
    let parent = "";
    for (const segment of directory.split("/")) {
      parent = parent ? `${parent}/${segment}` : segment;
      if (!await adapter.exists(parent)) await adapter.mkdir(parent);
    }
    // The UUID directory is exclusively owned by this attempt. Unknown occupants
    // fail before any write; incomplete attempts are not part of history quota.
    if (await adapter.exists(journalPath) || await adapter.exists(sourcePath)) {
      throw new Error("Project safety transaction already exists.");
    }
    await adapter.write(journalPath, journal);
    if (await adapter.read(journalPath) !== journal) throw new Error("Project safety journal read-back failed.");
    await adapter.write(sourcePath, args.sourceText);
    if (await adapter.read(sourcePath) !== args.sourceText) throw new Error("Project safety source read-back failed.");
    sourceVerified = true;

    try {
      await writeProjectTextAtRevisionWithProcess({
        expectedRevision: args.expectedRevision,
        nextText: args.nextText,
        readRevision: (text) => parseKmindzProjectV3FromSvgText(text)?.header.rev ?? null,
        process: async (transform) => {
          if (args.file.path !== targetPath) throw new Error("Project path changed during save.");
          commitStarted = true;
          await args.app.vault.process(args.file, transform);
        },
        safety: {
          expectedSourceText: args.sourceText,
          readCommitted: async () => {
            if (args.file.path !== targetPath) throw new Error("Project path changed during read-back.");
            return args.app.vault.read(args.file);
          },
        },
      });
    } catch (error) {
      // Only this path has completed both journal and full source read-back.
      throw new ObsidianVerifiedSourceWriteError(error, commitStarted ? "commit-uncertain" : "precommit");
    }
    // Cleanup errors do not undo a verified commit. Keep unknown/modified evidence.
    let cleanupCompleted = false;
    try {
      if (await adapter.read(sourcePath) !== args.sourceText) return;
      if (args.file.path !== targetPath || await args.app.vault.read(args.file) !== args.nextText) return;
      if (await adapter.read(journalPath) !== journal) return;
      await adapter.remove(sourcePath);
      if (args.file.path !== targetPath || await args.app.vault.read(args.file) !== args.nextText) return;
      if (await adapter.read(journalPath) !== journal) return;
      await adapter.remove(journalPath);
      await removeObsidianEmptySafetyDirectory(adapter, directory);
      cleanupCompleted = true;
    } catch (error) {
      console.warn("[kmind-zen] verified save retained safety transaction", error);
    } finally {
      if (!cleanupCompleted) args.onRetainedCompletedTransaction?.(retireCompleted);
    }
  } catch (error) {
    const failure = error instanceof ProjectSaveIOError ? error
      : new ProjectSaveIOError(error, commitStarted ? "commit-uncertain" : "precommit", sourceVerified);
    failure.retireBeforeRetry = async verifiedCurrent => {
      if (verifiedCurrent !== args.sourceText && verifiedCurrent !== args.nextText) throw Error("Retry retirement requires the exact source or candidate.");
      const archive = `${await resolveObsidianRetryArchiveDirectory(targetPath)}/${transactionId}`;
      const entries = [
        { active: sourcePath, archived: `${archive}/source.kmindz.svg`, expected: args.sourceText },
        { active: journalPath, archived: `${archive}/transaction.json`, expected: journal },
      ];
      const read = async (path: string) => await adapter.exists(path) ? adapter.read(path) : null;
      const assertCurrent = async () => {
        if (args.file.path !== targetPath || await args.app.vault.read(args.file) !== verifiedCurrent) throw Error("Project changed while preserving retry evidence.");
      };
      for (const entry of entries) {
        const text = await read(entry.active);
        if (text !== null && text !== entry.expected) throw Error("Retry evidence changed; preserve it in place.");
      }
      let parent = "";
      for (const segment of archive.split("/")) {
        parent = parent ? `${parent}/${segment}` : segment;
        if (!await adapter.exists(parent)) await adapter.mkdir(parent);
      }
      for (const entry of entries) {
        await assertCurrent();
        const text = await read(entry.archived);
        if (text !== null && text !== entry.expected) throw Error("Retry archive is occupied by different bytes.");
        if (text === null) await adapter.write(entry.archived, entry.expected);
        if (await read(entry.archived) !== entry.expected) throw Error("Retry archive readback failed.");
      }
      for (const entry of entries) {
        await assertCurrent();
        const text = await read(entry.active);
        if (text === null) continue;
        if (text !== entry.expected || await read(entry.archived) !== entry.expected) throw Error("Retry evidence changed before retirement.");
        await adapter.remove(entry.active);
      }
      // Unknown occupants are retained; they cannot authorize another deletion.
    };
    throw failure;
  }
}
