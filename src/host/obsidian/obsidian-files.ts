import { Notice, TFile, type App } from "obsidian";

import type { FilesPort } from "@kmind/app";

import { createObsidianUiI18n } from "../../i18n/ui-i18n";
import { bytesToArrayBuffer } from "../../storage/array-buffer";

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

export function createObsidianFilesPort(args: { app: App; baseFile: TFile }): FilesPort {
  return {
    async openFile({ accept, multiple }) {
      const input = document.createElement("input");
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

        document.body.appendChild(input);
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
