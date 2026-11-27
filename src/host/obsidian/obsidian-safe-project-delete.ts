import type { App, TFile } from "obsidian";

/** Caller validates the full source package and owns explicit root-delete intent. */
export async function trashObsidianProjectSafely(args: {
  app: App;
  file: TFile;
  sourceText: string;
  createCheckpoint: () => Promise<{ path: string }>;
}): Promise<void> {
  const targetPath = args.file.path;
  const assertSource = async () => {
    if (args.file.path !== targetPath || await args.app.vault.read(args.file) !== args.sourceText) {
      throw new Error("Project changed before deletion; source retained.");
    }
  };
  await assertSource();
  const checkpoint = await args.createCheckpoint();
  if (checkpoint.path === targetPath || await args.app.vault.adapter.read(checkpoint.path) !== args.sourceText) {
    throw new Error("Deletion checkpoint failed exact read-back verification.");
  }
  await assertSource();
  // Vault exposes no compare-and-delete primitive. Use its recoverable local
  // trash, never permanent deletion; an OS writer may still race this boundary.
  await args.app.vault.trash(args.file, false);
  if (await args.app.vault.adapter.exists(targetPath)) {
    throw new Error("Project path still exists after trash; deletion was not confirmed.");
  }
}
