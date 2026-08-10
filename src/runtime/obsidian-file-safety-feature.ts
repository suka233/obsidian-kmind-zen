import type { DocumentId, KmindApp, KmindFeature } from "@kmind/app";
import { parseKmindzProjectV3FromSvgText, unsafeGetKmindAppInternal } from "@kmind/app";
import { Modal, Setting, TFile, Notice, type App } from "obsidian";

type ConflictChoice = "reload" | "overwrite" | "save-as-copy" | "cancel";

class ConflictResolveModal extends Modal {
  private resolved = false;
  private resolveFn: (value: ConflictChoice) => void;
  private message: string;
  private t: (key: string, params?: Record<string, unknown> | undefined) => string;

  constructor(
    app: App,
    args: { message: string; t: (key: string, params?: Record<string, unknown> | undefined) => string },
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

async function openConflictResolveModal(
  app: App,
  args: { message: string; t: (key: string, params?: Record<string, unknown> | undefined) => string },
): Promise<ConflictChoice> {
  return new Promise<ConflictChoice>((resolve) => {
    const modal = new ConflictResolveModal(app, { message: args.message, t: args.t }, resolve);
    modal.open();
  });
}

function normalizeVaultPath(path: string): string {
  return String(path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
}

async function createUniqueSiblingPath(app: App, basePath: string): Promise<string> {
  const normalized = normalizeVaultPath(basePath);
  const dir = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
  const fullName = normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;
  const dot = fullName.lastIndexOf(".");
  const base = dot > 0 ? fullName.slice(0, dot) : fullName;
  const ext = dot > 0 ? fullName.slice(dot + 1) : "";

  const join = (name: string) => (dir ? `${dir}/${name}` : name);
  const withExt = (name: string) => (ext ? `${name}.${ext}` : name);

  const first = join(withExt(`${base} (copy)`));
  if (!app.vault.getAbstractFileByPath(first)) return first;

  for (let i = 2; i < 1000; i += 1) {
    const candidate = join(withExt(`${base} (copy ${i})`));
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
  }

  return join(withExt(`${base} (copy ${Date.now()})`));
}

async function reloadAllDocsFromStore(app: KmindApp): Promise<void> {
  const documents = app.host.ports.documents;
  const list = await documents.list();
  const docIds = list.map((item) => item.id);
  if (docIds.length === 0) return;
  await app.dispatch("mindmap.reloadDocsFromStore", { docIds });
}

export function createObsidianFileSafetyFeature(args: { obsidianApp: App; file: TFile }): KmindFeature {
  return {
    id: "obsidian-file-safety",
    async register(kmindApp) {
      const t = kmindApp.i18n.t;
      const vault = args.obsidianApp.vault;
      const internal = unsafeGetKmindAppInternal(kmindApp);
      const documents = kmindApp.host.ports.documents;
      const projectDiskSync = kmindApp.host.ports.projectDiskSync;

      let activeFilePath = args.file.path;
      let ignoreModifyUntil = 0;
      let lastSavedAt: number | null = kmindApp.getSnapshot().documents.status.lastSavedAt ?? null;
      let lastHandledSaveError: string | null = null;
      let handling = false;

      const markIgnoreWindow = () => {
        ignoreModifyUntil = Date.now() + 800;
      };

      const doReloadFromDisk = async () => {
        if (typeof projectDiskSync?.reloadFromDisk !== "function") return;
        internal.setDocumentsStatus({ suppressAutosave: true });
        try {
          await projectDiskSync.reloadFromDisk();
          await reloadAllDocsFromStore(kmindApp);
          internal.setDocumentsStatus({ dirty: false, saving: false, lastSaveError: null });
        } finally {
          internal.setDocumentsStatus({ suppressAutosave: false });
        }
      };

      const doMergeFromDisk = async (diskText?: string | undefined) => {
        const core = kmindApp.getSnapshot().editor.activeCore as unknown as { exportCollabState?: unknown } | null;
        const crdtEnabled = Boolean(core && typeof core.exportCollabState === "function");
        if (!crdtEnabled) {
          await doReloadFromDisk();
          return { ok: true as const, applied: false as const, reason: "non-crdt" as const };
        }

        const merger = projectDiskSync?.mergeExternalDiskChange;
        if (typeof merger !== "function") {
          await doReloadFromDisk();
          return { ok: true as const, applied: false as const, reason: "no-merger" as const };
        }

        const wasDirty = kmindApp.getSnapshot().documents.status.dirty;
        internal.setDocumentsStatus({ suppressAutosave: true });
        try {
          const result = await merger({ diskText });

          const rootDocId = kmindApp.getSnapshot().navigation.rootId ?? kmindApp.getSnapshot().documents.activeId;
          const rootRecord = rootDocId ? await kmindApp.host.ports.documents.get(rootDocId) : null;
          if (rootRecord) {
            internal.setDocuments([rootRecord]);
          }

          if (!wasDirty) {
            internal.setDocumentsStatus({ dirty: false, saving: false, lastSaveError: null });
          }

          return result;
        } finally {
          internal.setDocumentsStatus({ suppressAutosave: false });
        }
      };

      const doSaveAsCopy = async () => {
        const exporter = projectDiskSync?.exportCurrentProjectText;
        if (typeof exporter !== "function") return;
        const exported = await exporter();
        const path = await createUniqueSiblingPath(args.obsidianApp, activeFilePath);
        const created = await args.obsidianApp.vault.create(path, exported.text);
        new Notice(t("obsidian.fileSafety.notice.savedCopy", { path: created.path }));
        void args.obsidianApp.workspace.getLeaf(true).openFile(created);
      };

      const doOverwriteDisk = async () => {
        const forceWrite = projectDiskSync?.forceWriteCurrentProjectToDisk;
        if (typeof forceWrite !== "function") return;
        await forceWrite();
        internal.setDocumentsStatus({ dirty: false, saving: false, lastSaveError: null, lastSavedAt: Date.now() });
        new Notice(t("obsidian.fileSafety.notice.overwritten"));
      };

      const handleConflictChoice = async (choice: ConflictChoice) => {
        if (choice === "reload") {
          await doReloadFromDisk();
          kmindApp.focusCanvas();
          return;
        }
        if (choice === "overwrite") {
          await doOverwriteDisk();
          kmindApp.focusCanvas();
          return;
        }
        if (choice === "save-as-copy") {
          await doSaveAsCopy();
          // After saving a copy, reload the original file to clear the conflict state.
          await doReloadFromDisk();
          kmindApp.focusCanvas();
        }
      };

      const promptResolveConflict = async (reason: string) => {
        if (handling) return;
        handling = true;
        try {
          const capture = projectDiskSync?.captureConflictSnapshots;
          if (typeof capture === "function") {
            try {
              const diskText = await vault.read(args.file).catch(() => "");
              await capture({ diskText, force: true });
            } catch {
              // ignore
            }
          }

          const reasonLabel =
            reason === "external modify"
              ? t("obsidian.fileSafety.reason.externalModify")
              : reason === "save conflict"
                ? t("obsidian.fileSafety.reason.saveConflict")
                : reason;
          const choice = await openConflictResolveModal(args.obsidianApp, {
            t,
            message: t("obsidian.fileSafety.conflict.message", { reason: reasonLabel }),
          });
          await handleConflictChoice(choice);
        } finally {
          handling = false;
        }
      };

      const debouncedExternalModify = (() => {
        let timer: number | null = null;
        return () => {
          if (timer !== null) return;
          timer = window.setTimeout(() => {
            timer = null;
            void (async () => {
              if (Date.now() < ignoreModifyUntil) return;
              const snapshot = kmindApp.getSnapshot();
              const status = snapshot.documents.status;
              if (status.saving) return;

              const diskText = await vault.read(args.file).catch(() => "");
              try {
                const merged = await doMergeFromDisk(diskText);
                if (merged.applied) {
                  new Notice(t("obsidian.fileSafety.notice.merged"));
                  return;
                }
                if (
                  merged.reason === "missing-collab-update" ||
                  merged.reason === "missing-collab-context" ||
                  merged.reason === "collab-project-mismatch"
                ) {
                  if (!status.dirty) {
                    await doReloadFromDisk();
                    new Notice(t("obsidian.fileSafety.notice.reloaded"));
                    return;
                  }
                  await promptResolveConflict("external modify");
                  return;
                }
              } catch (error) {
                if (!status.dirty) {
                  try {
                    await doReloadFromDisk();
                    new Notice(t("obsidian.fileSafety.notice.reloaded"));
                  } catch (reloadError) {
                    const message = reloadError instanceof Error ? reloadError.message : String(reloadError);
                    new Notice(t("obsidian.fileSafety.notice.reloadFailed", { message }));
                  }
                  return;
                }
                await promptResolveConflict("external modify");
              }
            })();
          }, 180);
        };
      })();

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
        const nextSavedAt = snapshot.documents.status.lastSavedAt ?? null;
        if (nextSavedAt && nextSavedAt !== lastSavedAt) {
          lastSavedAt = nextSavedAt;
          markIgnoreWindow();
        }

        const saveError = snapshot.documents.status.lastSaveError ?? null;
        if (!saveError || saveError === lastHandledSaveError) return;
        lastHandledSaveError = saveError;

        if (saveError.startsWith("Save conflict detected")) {
          void promptResolveConflict("save conflict");
          return;
        }
        if (saveError.startsWith("Invalid kmindz project file")) {
          new Notice(t("obsidian.fileSafety.notice.invalidKmindz"));
          return;
        }

        new Notice(t("obsidian.fileSafety.notice.saveError", { message: saveError }));
      });

      // If the file is already invalid, fail-fast with a helpful notice.
      const initialText = await vault.read(args.file).catch(() => "");
      if (initialText.trim().length > 0 && !parseKmindzProjectV3FromSvgText(initialText)) {
        new Notice(t("obsidian.fileSafety.notice.invalidKmindz"));
      }

      return () => {
        unsubscribeApp();
        vault.offref(vaultModifyRef);
        vault.offref(vaultRenameRef);
      };
    },
  };
}
