import type { App, TFile } from "obsidian";
import {
  ProjectSaveIOError,
  ProjectSourceChangedError,
  sha256HexText,
} from "@kmind/app";
import { ObsidianSaveConflictError } from "./obsidian-save-conflict";

export async function resolveObsidianSafetyDirectory(targetPath: string): Promise<string> {
  return `.kmind-zen/safety/${await sha256HexText(targetPath)}`;
}

export async function resolveObsidianRetryArchiveDirectory(targetPath: string): Promise<string> {
  return `.kmind-zen/retry-archives/${await sha256HexText(targetPath)}`;
}

/**
 * A save's crash copy (phase-25.8): the complete candidate, flat in the file's safety directory,
 * named `<attempt id>.<candidate SHA-256>.kmindz`. The name is its journal: which version it holds
 * and, against the file, whether that version was committed.
 */
const SAFETY_COPY_NAME = /^([a-zA-Z0-9-]{1,64})\.([a-f0-9]{64})\.kmindz$/u;

export function obsidianSafetyCopyFileName(attemptId: string, candidateFingerprint: string): string {
  const name = `${attemptId}.${candidateFingerprint}.kmindz`;
  if (!SAFETY_COPY_NAME.test(name)) throw new Error("Invalid safety copy name.");
  return name;
}

export function parseObsidianSafetyCopyFileName(fileName: string): Readonly<{ attemptId: string; candidateFingerprint: string }> | null {
  const match = SAFETY_COPY_NAME.exec(fileName);
  return match ? Object.freeze({ attemptId: match[1]!, candidateFingerprint: match[2]! }) : null;
}

/** Moves a safety copy, unchanged, into the file's retry archive, where recovery lists it. */
export async function archiveObsidianSafetyCopy(adapter: App["vault"]["adapter"], targetPath: string, copyPath: string): Promise<void> {
  const fileName = copyPath.slice(copyPath.lastIndexOf("/") + 1);
  if (!copyPath.startsWith(`${await resolveObsidianSafetyDirectory(targetPath)}/`) || !parseObsidianSafetyCopyFileName(fileName)) {
    throw new Error("Invalid safety copy path.");
  }
  const archive = await resolveObsidianRetryArchiveDirectory(targetPath);
  if (!await adapter.exists(archive)) await adapter.mkdir(archive);
  await adapter.rename(copyPath, `${archive}/${fileName}`);
}

/** Old layout (phase-21.30 to 25.7): an attempt directory with `transaction.json` and `source.kmindz.svg`. */
export async function removeObsidianEmptySafetyDirectory(adapter: App["vault"]["adapter"], directory: string): Promise<void> {
  if (!/^\.kmind-zen\/safety\/[a-f0-9]{64}\/[a-zA-Z0-9_-]+$/u.test(directory)) throw new Error("Invalid safety cleanup directory.");
  const entries = await adapter.list(directory);
  if (entries.files.length || entries.folders.length) throw new Error("Safety directory is not empty; preserve its occupants.");
  // FileSystemAdapter uses fs.rm: recursive=false rejects even an empty directory.
  // Only this exact, freshly checked empty attempt may use the directory API.
  await adapter.rmdir(directory, true);
}

/**
 * Old layout: moves exactly one save attempt's journal and source copy into the retry archive,
 * where recovery still lists them: each must still hold its expected bytes, every copy is read
 * back before an active file is removed, and the journal goes last. Unknown occupants of the
 * attempt's directory are retained.
 */
export async function retireObsidianSaveAttempt(args: {
  adapter: App["vault"]["adapter"];
  targetPath: string;
  transactionId: string;
  /** Expected bytes; `null` for a source copy the attempt does not have. */
  files: Readonly<{ source: string | null; journal: string }>;
}): Promise<void> {
  const adapter = args.adapter;
  const directory = `${await resolveObsidianSafetyDirectory(args.targetPath)}/${args.transactionId}`;
  const archive = `${await resolveObsidianRetryArchiveDirectory(args.targetPath)}/${args.transactionId}`;
  const entries = [
    { active: `${directory}/source.kmindz.svg`, archived: `${archive}/source.kmindz.svg`, expected: args.files.source },
    { active: `${directory}/transaction.json`, archived: `${archive}/transaction.json`, expected: args.files.journal },
  ];
  const read = async (path: string) => await adapter.exists(path) ? adapter.read(path) : null;
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
    if (entry.expected === null) continue;
    const text = await read(entry.archived);
    if (text !== null && text !== entry.expected) throw Error("Retry archive is occupied by different bytes.");
    if (text === null) await adapter.write(entry.archived, entry.expected);
    if (await read(entry.archived) !== entry.expected) throw Error("Retry archive readback failed.");
  }
  for (const entry of entries) {
    const text = await read(entry.active);
    if (text === null) continue;
    if (text !== entry.expected || await read(entry.archived) !== entry.expected) throw Error("Retry evidence changed before retirement.");
    await adapter.remove(entry.active);
  }
}

/**
 * One project-file write (phase-25.8, audit 7.1):
 * 1. the complete candidate is written as the attempt's safety copy (no read-back: a read-back
 *    reads the page cache and adds nothing against a crash);
 * 2. Obsidian's `process` replaces the file only while it is exactly `baselineText`, inside its
 *    write queue;
 * 3. the file is read back and compared with the candidate;
 * 4. the copy is removed.
 *
 * Desktop writes truncate before writing and a rename cannot replace a file, so a complete
 * version stays on disk while the file is rewritten. Failures:
 * - the copy cannot be written: nothing was committed (`precommit`); a retry removes the copy,
 *   which may be partial and holds nothing the session does not;
 * - `process` fails, or the read-back differs: the commit is uncertain; the copy stays, a retry
 *   moves it to the retry archive;
 * - `process` found other bytes than the baseline: nothing was written. Bytes the caller adopts
 *   (the same content: another version's preview or timestamps) are replaced once; otherwise this
 *   is an ordinary conflict and the copy moves to the retry archive;
 * - the copy cannot be removed: the commit stands; the caller removes it before its next write.
 */
export async function writeObsidianProjectSafely(args: {
  app: App;
  file: TFile;
  /** The exact text this session last wrote or adopted: the only bytes this write may replace. */
  baselineText: string;
  nextText: string;
  /** SHA-256 of `nextText`; the caller computed it for the candidate's descriptor. */
  candidateFingerprint: string;
  /** The file's safety directory; the caller makes sure of it once per session. */
  ensureSafetyDirectory: () => Promise<string>;
  /**
   * The process found other bytes than the baseline. True when the caller adopted them as its new
   * baseline, so this write replaces them; false when they are another version (a conflict).
   */
  adoptChangedSource: (currentText: string) => Promise<boolean>;
  /** A committed write whose copy could not be removed: `remove` removes it before the next write. */
  onRetainedCompletedCopy: (remove: () => Promise<void>) => void;
}): Promise<void> {
  const targetPath = args.file.path;
  const adapter = args.app.vault.adapter;
  const copyName = obsidianSafetyCopyFileName(globalThis.crypto.randomUUID(), args.candidateFingerprint);
  let copyPath = "";
  const precommit = (cause: unknown) => {
    const failure = new ProjectSaveIOError(cause, "precommit");
    failure.retireBeforeRetry = async () => {
      if (copyPath && await adapter.exists(copyPath)) await adapter.remove(copyPath);
    };
    return failure;
  };
  const uncertain = (cause: unknown) => {
    const failure = new ProjectSaveIOError(cause, "commit-uncertain", true);
    failure.retireBeforeRetry = () => archiveObsidianSafetyCopy(adapter, targetPath, copyPath);
    return failure;
  };

  try {
    copyPath = `${await args.ensureSafetyDirectory()}/${copyName}`;
    await adapter.write(copyPath, args.nextText);
  } catch (error) {
    throw precommit(error);
  }

  /** Other bytes than `baseline` when the process refused them; null once it wrote the candidate. */
  const commitOver = async (baseline: string): Promise<string | null> => {
    if (args.file.path !== targetPath) throw precommit(new Error("Project path changed during save."));
    let found: string | null = null;
    try {
      await args.app.vault.process(args.file, (current) => {
        if (current !== baseline) {
          found = current;
          throw new ProjectSourceChangedError();
        }
        return args.nextText;
      });
    } catch (error) {
      if (error instanceof ProjectSourceChangedError && found !== null) return found;
      throw uncertain(error);
    }
    return null;
  };

  let found = await commitOver(args.baselineText);
  if (found !== null && await args.adoptChangedSource(found)) found = await commitOver(found);
  if (found !== null) {
    try {
      await archiveObsidianSafetyCopy(adapter, targetPath, copyPath);
    } catch (error) {
      // Still a conflict: the copy stays in place, and opening later stores it with the conflicts.
      console.error("[kmind-zen] the superseded save's safety copy could not be archived", error);
    }
    throw new ObsidianSaveConflictError("Save conflict detected: the project file changed on disk before this save was committed.");
  }

  let committed: string;
  try {
    if (args.file.path !== targetPath) throw new Error("Project path changed during read-back.");
    committed = await args.app.vault.read(args.file);
  } catch (error) {
    throw uncertain(error);
  }
  if (committed !== args.nextText) throw uncertain(new Error("Project process commit failed exact read-back verification."));

  try {
    await adapter.remove(copyPath);
  } catch (error) {
    console.warn("[kmind-zen] the committed save's safety copy could not be removed", error);
    args.onRetainedCompletedCopy(async () => {
      if (await adapter.exists(copyPath)) await adapter.remove(copyPath);
    });
  }
}
