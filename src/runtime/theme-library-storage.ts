import { createFileThemeLibraryStoragePort, type HydratableThemeLibraryStoragePort } from "@kmind/app";
import { normalizePath, type App } from "obsidian";

const THEME_LIBRARY_DIR = ".kmind-zen/themes";

const storageByApp = new WeakMap<App, HydratableThemeLibraryStoragePort>();

class ObsidianThemeFileNotFoundError extends Error {}

async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const exists = await app.vault.adapter.exists(current);
    if (!exists) await app.vault.createFolder(current);
  }
}

function basename(path: string): string {
  return normalizePath(path).split("/").filter(Boolean).pop() ?? path;
}

export function getObsidianThemeLibraryStoragePort(app: App): HydratableThemeLibraryStoragePort {
  const cached = storageByApp.get(app);
  if (cached) return cached;

  const port = createFileThemeLibraryStoragePort({
    rootDir: THEME_LIBRARY_DIR,
    adapter: {
      readText: async (path) => {
        const normalized = normalizePath(path);
        const exists = await app.vault.adapter.exists(normalized);
        if (!exists) throw new ObsidianThemeFileNotFoundError(`File not found: ${normalized}`);
        return app.vault.adapter.read(normalized);
      },
      writeText: async (path, text) => {
        const normalized = normalizePath(path);
        const dir = normalized.split("/").slice(0, -1).join("/");
        if (dir) await ensureFolder(app, dir);
        await app.vault.adapter.write(normalized, text);
      },
      readDir: async (path) => {
        const normalized = normalizePath(path);
        const exists = await app.vault.adapter.exists(normalized);
        if (!exists) return [];
        const listed = await app.vault.adapter.list(normalized);
        return [
          ...listed.files.map((file) => ({ name: basename(file), isDir: false })),
          ...listed.folders.map((folder) => ({ name: basename(folder), isDir: true })),
        ];
      },
      removeFile: async (path) => {
        const normalized = normalizePath(path);
        const exists = await app.vault.adapter.exists(normalized);
        if (!exists) return;
        await app.vault.adapter.remove(normalized);
      },
      isNotFoundError: (error) => error instanceof ObsidianThemeFileNotFoundError,
    },
  });

  storageByApp.set(app, port);
  return port;
}
