import type { KmindApp, KmindFeature } from "@kmind/app";
import {
  adoptDiskProjectVersion,
  assertCanvasOpenEditorsSettled,
  projectProtectionError,
  describeLegacyMigrationRefusal,
  describeWhiteboardReadFailure,
  readLiveProjectRecords,
  resolveProjectSaveFailure,
  translateProjectProtectionFailure,
} from "@kmind/app";
import { Modal, Setting, TFile, Notice, type App } from "obsidian";

import type { ObsidianEditLease } from "./obsidian-edit-lease";

type ConflictChoice = "reload" | "overwrite" | "save-as-copy" | "cancel";
type Translate = KmindApp["i18n"]["t"];

class ConflictResolveModal extends Modal {
  private resolved = false;
  private resolveFn: (value: ConflictChoice) => void;
  private message: string;
  private t: Translate;

  constructor(
    app: App,
    args: { message: string; t: Translate },
    resolve: (value: ConflictChoice) => void,
  ) {
    super(app);
    this.resolveFn = resolve;
    this.message = args.message;
    this.t = args.t;
  }

  override onOpen(): void {
    const t = this.t;
    this.titleEl.setText(t("obsidian.fileSafety.modal.title"));
    this.contentEl.createEl("p", { text: this.message });

    const footer = this.contentEl.createDiv({ cls: "kmind-zen-conflict-modal" });
    new Setting(footer)
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.fileSafety.modal.choice.reload"));
        btn.onClick(() => this.finish("reload"));
      })
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.fileSafety.modal.choice.overwrite"));
        btn.onClick(() => this.finish("overwrite"));
      })
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.fileSafety.modal.choice.saveAsCopy"));
        btn.setCta();
        btn.onClick(() => this.finish("save-as-copy"));
      })
      .addButton((btn) => {
        btn.setButtonText(t("kmind.common.cancel"));
        btn.onClick(() => this.finish("cancel"));
      });
  }

  override onClose(): void {
    if (!this.resolved) this.finish("cancel");
    this.contentEl.empty();
  }

  private finish(choice: ConflictChoice): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn(choice);
    this.close();
  }
}

async function openConflictResolveModal(app: App, args: { message: string; t: Translate }): Promise<ConflictChoice> {
  return new Promise<ConflictChoice>((resolve) => {
    const modal = new ConflictResolveModal(app, { message: args.message, t: args.t }, resolve);
    modal.open();
  });
}

function describeError(t: KmindApp["i18n"]["t"], error: unknown): string {
  // A file a newer version wrote, or a whiteboard this version cannot read, says so in the user's
  // language (phase-34.24); other failures keep their technical message.
  const whiteboard = describeWhiteboardReadFailure(t, error) ?? describeLegacyMigrationRefusal(t, error);
  if (whiteboard) return whiteboard;
  return error instanceof Error ? error.message : String(error);
}

/**
 * External changes and save conflicts of a JSON-canonical project. A changed disk version is
 * verified by the host before anything happens; a clean session adopts it (with a notice only
 * in the view that edits), a session with unsaved edits (even ones typed during the reload)
 * gets the conflict dialog instead, after both sides were stored as conflict snapshots. The
 * host tells this session's own writes apart by revision, fingerprint and content identity, so
 * every modification is checked: one at a time, and one that arrives during a save once that
 * save has finished. Before the view that edits (or takes over editing) loads a version this
 * device did not write, the host stores the session in history; without that, nothing is loaded.
 */
export function createObsidianFileSafetyFeature(args: {
  obsidianApp: App;
  file: TFile;
  editLease: Pick<ObsidianEditLease, "setTakeoverCheck" | "isEditable">;
  /** Settles save transactions an earlier editing view left, by the rules of opening; never throws. */
  prepareTakeover(): Promise<void>;
}): KmindFeature {
  return {
    id: "obsidian-file-safety",
    async register(kmindApp) {
      const t = kmindApp.i18n.t;
      const vault = args.obsidianApp.vault;
      const projectDiskSync = kmindApp.host.ports.projectDiskSync;

      let activeFilePath = args.file.path;
      let lastHandledSaveError: string | null = null;
      let lastStatusSaving = kmindApp.getSnapshot().documents.status.saving;
      let handling = false;
      let disposed = false;
      // The lease runs the takeover check while this view holds the lock but is not yet editable.
      let takingOver = false;
      // "Save as copy" and "cancel" keep the conflict: the next save asks again, not the watcher.
      let conflictKept = false;

      const isProtected = () => {
        const state = kmindApp.host.ports.projectSaveIntegrity?.getState();
        return state?.mode === "quarantine" || Boolean(state?.retry);
      };

      const readDiskVersion = (force: boolean) => {
        const read = projectDiskSync?.readDiskProjectVersion;
        if (typeof read !== "function") throw new Error("Disk version reading is not available in the current host adapter.");
        return read({ force });
      };

      type ReloadOutcome = Readonly<{ kind: "adopted"; preservedLocalVersion: boolean }> | Readonly<{ kind: "unchanged" | "local-edits" }>;

      /** `discardLocalEdits` only after the local side was stored as a conflict snapshot. */
      const reloadFromDisk = async (discardLocalEdits: boolean): Promise<ReloadOutcome> => {
        const version = await readDiskVersion(discardLocalEdits);
        if (version.kind === "unchanged") return { kind: "unchanged" };
        const result = await adoptDiskProjectVersion(kmindApp, {
          version, discardLocalEdits, preserveLocalVersion: args.editLease.isEditable() || takingOver,
        });
        if (result.kind === "local-edits") {
          if (discardLocalEdits) {
            assertCanvasOpenEditorsSettled(kmindApp);
            throw projectProtectionError("session-changed", "Local input changed after the conflict snapshot. Review the conflict again.");
          }
          return { kind: "local-edits" };
        }
        // The replaced session starts at the root map; return to the map that was open.
        const previous = result.previousActiveId;
        if (previous && previous !== version.rootDocId && version.records.some((record) => record.id === previous)
          && kmindApp.isCommandEnabled("submap.navigateTo", { docId: previous })) {
          await kmindApp.dispatch("submap.navigateTo", { docId: previous });
        }
        return { kind: "adopted", preservedLocalVersion: result.preservedLocalVersion };
      };

      const doSaveAsCopy = async () => {
        if (!kmindApp.isCommandEnabled("document.exportUnsavedProject")) throw new Error(t("app.saveProtection.warning"));
        await kmindApp.dispatch("document.exportUnsavedProject");
      };

      const doOverwriteDisk = async () => {
        const prepare = projectDiskSync?.prepareOverwriteDiskVersion;
        if (typeof prepare !== "function") throw new Error("Overwrite is not available in the current host adapter.");
        await prepare();
        await kmindApp.dispatch("document.saveNow");
        new Notice(t("obsidian.fileSafety.notice.overwritten"));
      };

      const handleConflictChoice = async (choice: ConflictChoice) => {
        conflictKept = choice === "save-as-copy" || choice === "cancel";
        if (choice === "reload") {
          await reloadFromDisk(true);
          new Notice(t("obsidian.fileSafety.notice.reloaded"));
        } else if (choice === "overwrite") {
          await doOverwriteDisk();
        } else if (choice === "save-as-copy") {
          await doSaveAsCopy();
        }
        // "save-as-copy" and "cancel" keep the conflict: the next conflicting save asks again.
        kmindApp.focusCanvas();
      };

      const promptResolveConflict = async (reason: "external modify" | "save conflict") => {
        if (isProtected()) { new Notice(t("app.saveProtection.warning")); return; }
        if (handling) return;
        handling = true;
        try {
          const capture = projectDiskSync?.captureConflictSnapshots;
          try {
            assertCanvasOpenEditorsSettled(kmindApp);
            if (typeof capture !== "function") throw new Error("Conflict snapshots are not available in the current host adapter.");
            const live = await readLiveProjectRecords(kmindApp);
            await capture({ diskText: await vault.read(args.file), localRecords: live.records });
          } catch (error) {
            // Without evidence of both sides, no choice that replaces either side is offered.
            new Notice(t("obsidian.fileSafety.notice.conflictSnapshotFailed", { message: describeError(t, error) }));
            return;
          }
          const reasonLabel = reason === "external modify"
            ? t("obsidian.fileSafety.reason.externalModify")
            : t("obsidian.fileSafety.reason.saveConflict");
          const choice = await openConflictResolveModal(args.obsidianApp, {
            t,
            message: t("obsidian.fileSafety.conflict.message", { reason: reasonLabel }),
          });
          if (disposed) return;
          try {
            await handleConflictChoice(choice);
          } catch (error) {
            new Notice(t("obsidian.fileSafety.notice.conflictActionFailed", { message: describeError(t, error) }));
          }
        } finally {
          handling = false;
        }
      };

      let checkAfterSave = false;
      const checkDiskVersion = async () => {
        if (disposed || isProtected()) return;
        const status = kmindApp.getSnapshot().documents.status;
        // The save may have written before this modification landed: check once it has finished.
        if (status.saving) { checkAfterSave = true; return; }
        try {
          if (status.dirty) {
            if (conflictKept) return;
            // Only a verified, changed version is a conflict; this session's own writes are not.
            if ((await readDiskVersion(false)).kind === "unchanged" || disposed) return;
            await promptResolveConflict("external modify");
            return;
          }
          const outcome = await reloadFromDisk(false);
          if (disposed) return;
          // Only the editing view tells the user; read-only views follow its saves silently.
          if (outcome.kind === "adopted" && args.editLease.isEditable()) {
            new Notice(t(outcome.preservedLocalVersion ? "obsidian.fileSafety.notice.reloadedPreserved" : "obsidian.fileSafety.notice.reloaded"));
          } else if (outcome.kind === "local-edits") await promptResolveConflict("external modify");
        } catch (error) {
          if (disposed) return;
          new Notice(t("obsidian.fileSafety.notice.reloadFailed", { message: describeError(t, error) }));
        }
      };

      // One check at a time; a modification during a check runs one more check afterwards,
      // and the returned promise settles only after that check.
      let running: Promise<void> | null = null;
      let recheck = false;
      const requestDiskCheck = (): Promise<void> => {
        if (disposed) return Promise.resolve();
        if (running) { recheck = true; return running; }
        running = (async () => {
          try {
            do {
              recheck = false;
              await checkDiskVersion();
            } while (recheck && !disposed);
          } finally {
            running = null;
          }
        })();
        return running;
      };
      // A view that waited read-only edits only from the current disk version, with no save
      // transaction of an earlier editing view left unsettled.
      args.editLease.setTakeoverCheck(async () => {
        await args.prepareTakeover();
        takingOver = true;
        try {
          await requestDiskCheck();
        } finally {
          takingOver = false;
        }
      });

      let timer: number | null = null;
      const debouncedExternalModify = () => {
        if (disposed || timer !== null) return;
        timer = window.setTimeout(() => {
          timer = null;
          void requestDiskCheck();
        }, 180);
      };

      const vaultModifyRef = vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        if (file.path !== activeFilePath) return;
        debouncedExternalModify();
      });

      const vaultRenameRef = vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (oldPath !== activeFilePath) return;
        activeFilePath = file.path;
      });

      const unsubscribeApp = kmindApp.subscribe(() => {
        const snapshot = kmindApp.getSnapshot();
        const status = snapshot.documents.status;
        const saveFinished = lastStatusSaving && !status.saving;
        lastStatusSaving = status.saving;
        if (saveFinished) conflictKept = false;
        if (saveFinished && checkAfterSave) {
          checkAfterSave = false;
          debouncedExternalModify();
        }

        const saveError = status.lastSaveError ?? null;
        if (!saveError) {
          lastHandledSaveError = null;
          return;
        }
        if (saveError.startsWith("Save conflict detected")) {
          // Every failed attempt of an unresolved conflict asks again, one dialog at a time.
          if (saveError === lastHandledSaveError && !saveFinished) return;
          lastHandledSaveError = saveError;
          void promptResolveConflict("save conflict");
          return;
        }
        if (saveError === lastHandledSaveError) return;
        lastHandledSaveError = saveError;
        if (saveError.startsWith("Invalid kmindz project file")) {
          new Notice(t("obsidian.fileSafety.notice.invalidKmindz"));
          return;
        }

        const failure = resolveProjectSaveFailure(status.lastSaveFailure ?? saveError, kmindApp.host.ports.projectSaveIntegrity?.getState());
        new Notice(t("obsidian.fileSafety.notice.saveError", { message: translateProjectProtectionFailure(kmindApp.i18n.t, failure) }));
      });

      // The runtime verified the file just before registering this feature (phase-25.9: no read
      // here). A file broken since then is refused by the next save, with the same notice.
      return () => {
        disposed = true;
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        unsubscribeApp();
        vault.offref(vaultModifyRef);
        vault.offref(vaultRenameRef);
      };
    },
  };
}
