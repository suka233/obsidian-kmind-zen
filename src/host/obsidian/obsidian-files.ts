import { Notice, TFile, type App } from "obsidian";

import type { FilesPort } from "@kmind/app";
import { createRecoveryFilePicker } from "@kmind/host-local";

import { createObsidianUiI18n } from "../../i18n/ui-i18n";
import { bytesToArrayBuffer } from "../../storage/array-buffer";
import { obsidianRecoverySourceFormat } from "./obsidian-project-recovery";

function normalizeVaultPath(path: string): string {
  return String(path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function sanitizeFileName(name: string): string {
  const trimmed = String(name ?? "").trim() || "download.bin";
  return trimmed.replace(/[\\/]+/g, "_");
}

function splitBaseExt(fileName: string): { base: string; ext: string } {
  const normalized = sanitizeFileName(fileName);
  const dot = normalized.lastIndexOf(".");
  if (dot <= 0 || dot === normalized.length - 1) return { base: normalized, ext: "" };
  return { base: normalized.slice(0, dot), ext: normalized.slice(dot + 1) };
}

async function createUniqueFilePath(app: App, dir: string, fileName: string): Promise<string> {
  const normalizedDir = normalizeVaultPath(dir).replace(/\/+$/g, "");
  const safeName = sanitizeFileName(fileName);
  const { base, ext } = splitBaseExt(safeName);
  const withExt = (candidateBase: string) => (ext ? `${candidateBase}.${ext}` : candidateBase);
  const join = (candidate: string) => (normalizedDir ? `${normalizedDir}/${candidate}` : candidate);

  const first = join(withExt(base));
  if (!app.vault.getAbstractFileByPath(first)) return first;

  for (let i = 2; i < 1000; i += 1) {
    const candidate = join(withExt(`${base} (${i})`));
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
  }

  return join(withExt(`${base}-${Date.now()}`));
}

async function readAsBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * The window a system dialog belongs to: the focused one, which is the popout window when the recovery tool
 * or the map is used there (`getCurrentWindow` is always the main window). With no window focused, the main window.
 */
function dialogParentWindow(remote: { BrowserWindow: { getFocusedWindow(): unknown }; getCurrentWindow(): unknown }): unknown {
  return remote.BrowserWindow.getFocusedWindow() ?? remote.getCurrentWindow();
}

/**
 * The recovery tool's external source picker (phase-34.16): the system open dialog, starting in the vault's
 * `.kmind-zen/projects` folder (where every project's history checkpoints are) with hidden files shown, so a
 * checkpoint can be picked when the broken file no longer names its project. The plugin is desktop only.
 * A chosen file that is no source (a `.preview.svg` thumbnail sits next to the checkpoints) is refused
 * with a notice saying so, and nothing is selected.
 */
export function createObsidianRecoverySourcePicker(app: App): () => Promise<{ name: string; bytes: Uint8Array } | null> {
  return async () => {
    const load = (globalThis as unknown as { require?: (id: string) => any }).require;
    if (!load) throw new Error("[kmind-zen] the system open dialog is not available.");
    const remote = load("@electron/remote");
    const fs = load("node:fs/promises");
    const basePath = (app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
    const result = await remote.dialog.showOpenDialog(dialogParentWindow(remote), {
      ...(basePath ? { defaultPath: `${basePath}/.kmind-zen/projects` } : {}),
      properties: ["openFile", "showHiddenFiles"],
      filters: [{ name: "KMind", extensions: ["kmindz", "svg", "yjs", "json"] }],
    });
    const path = result.canceled ? null : result.filePaths?.[0];
    if (!path) return null;
    const name = String(path).split(/[\\/]/u).at(-1)!;
    if (!obsidianRecoverySourceFormat(name)) {
      new Notice(createObsidianUiI18n().t("obsidian.recovery.source.unsupported"));
      return null;
    }
    return { name, bytes: new Uint8Array(await fs.readFile(path)) };
  };
}

export function createObsidianFilesPort(args: { app: App; baseFile: TFile }): FilesPort {
  return {
    chooseRecoveryFile: createRecoveryFilePicker({ native: () => {
      const load = (globalThis as unknown as { require?: (id: string) => any }).require;
      if (!load) return null;
      const remote = load("@electron/remote");
      return { fs: load("node:fs/promises"), dialog: options => remote.dialog.showSaveDialog(dialogParentWindow(remote), options) };
    } }),
    async openFile({ accept, multiple }) {
      // The document of the window in use (a popout window's own document there), as Obsidian names it.
      const ownerDocument = activeDocument;
      const input = ownerDocument.createElement("input");
      input.type = "file";
      input.accept = Array.isArray(accept) ? accept.join(",") : "";
      input.multiple = Boolean(multiple);
      input.style.display = "none";

      const cleanup = () => {
        try {
          input.remove();
        } catch {
          // ignore
        }
      };

      return new Promise<{ name: string; bytes: Uint8Array } | null>((resolve, reject) => {
        input.addEventListener("cancel", () => {
          cleanup();
          resolve(null);
        }, { once: true });
        input.addEventListener(
          "change",
          () => {
            const picked = input.files && input.files.length > 0 ? input.files[0] : null;
            if (!picked) {
              cleanup();
              resolve(null);
              return;
            }
            void readAsBytes(picked)
              .then((bytes) => {
                cleanup();
                resolve({ name: picked.name, bytes });
              })
              .catch((error) => {
                cleanup();
                reject(error);
              });
          },
          { once: true },
        );

        ownerDocument.body.appendChild(input);
        input.click();
      });
    },

    async downloadFile({ name, bytes }) {
      const parentDir = args.baseFile.parent?.path ?? "";
      const path = await createUniqueFilePath(args.app, parentDir, name);
      const created = await args.app.vault.createBinary(path, bytesToArrayBuffer(bytes));
      const t = createObsidianUiI18n().t;
      new Notice(t("obsidian.notice.exported", { path: created.path }));
    },
  };
}
