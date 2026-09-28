import { Notice, type Plugin, TFile } from "obsidian";

const DEV_RELOAD_MARKER_FILE = ".kmind-dev-reload.json";
const DEV_REOPEN_PATH_KEY = "kmind-zen:dev:reopen-path";
const DEV_REOPEN_AT_KEY = "kmind-zen:dev:reopen-at";

type ObsidianInternalPlugins = {
  disablePlugin?: ((id: string) => unknown) | undefined;
  enablePlugin?: ((id: string) => unknown) | undefined;
  disablePluginAndSave?: ((id: string) => unknown) | undefined;
  enablePluginAndSave?: ((id: string) => unknown) | undefined;
};

function getPluginManager(app: unknown): ObsidianInternalPlugins | null {
  const manager = (app as { plugins?: unknown } | null | undefined)?.plugins as ObsidianInternalPlugins | undefined;
  if (!manager) return null;
  return manager;
}

function recordActiveKmindzPathForReopen(plugin: Plugin): void {
  const active = plugin.app.workspace.getActiveFile();
  if (!active || active.extension !== "kmindz") return;
  try {
    window.localStorage.setItem(DEV_REOPEN_PATH_KEY, active.path);
    window.localStorage.setItem(DEV_REOPEN_AT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export async function maybeReopenAfterDevReload(plugin: Plugin): Promise<void> {
  const path = (() => {
    try {
      const raw = window.localStorage.getItem(DEV_REOPEN_PATH_KEY);
      return raw ? String(raw).trim() : "";
    } catch {
      return "";
    }
  })();
  if (!path) return;

  try {
    window.localStorage.removeItem(DEV_REOPEN_PATH_KEY);
    window.localStorage.removeItem(DEV_REOPEN_AT_KEY);
  } catch {
    // ignore
  }

  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  if (file.extension !== "kmindz") return;
  await plugin.app.workspace.getLeaf(true).openFile(file);
}

async function reloadPlugin(plugin: Plugin, reason: string): Promise<void> {
  const id = plugin.manifest.id;
  const plugins = getPluginManager(plugin.app);
  if (!plugins) {
    new Notice(`KMind Dev: auto-reload skipped (${reason}): plugin manager is not available.`);
    return;
  }

  const disable = plugins.disablePluginAndSave ?? plugins.disablePlugin;
  const enable = plugins.enablePluginAndSave ?? plugins.enablePlugin;
  if (typeof disable !== "function" || typeof enable !== "function") {
    new Notice(`KMind Dev: auto-reload skipped (${reason}): disable/enable API is not available.`);
    return;
  }

  recordActiveKmindzPathForReopen(plugin);

  try {
    disable.call(plugins, id);
  } catch {
    // ignore
  }

  try {
    await Promise.resolve(enable.call(plugins, id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    new Notice(`KMind Dev: auto-reload failed (${reason}): ${message}`);
  }
}

export async function devReloadPluginNow(plugin: Plugin): Promise<void> {
  await reloadPlugin(plugin, "manual");
}

export function setupDevAutoReload(plugin: Plugin): { dispose: () => void } {
  const adapter = plugin.app.vault.adapter;
  const stat = (adapter as { stat?: ((path: string) => Promise<{ mtime: number; size: number } | null>) | undefined }).stat;
  if (typeof stat !== "function") return { dispose: () => {} };

  const configDir = plugin.app.vault.configDir;
  const pluginId = plugin.manifest.id;
  const markerPath = `${configDir}/plugins/${pluginId}/${DEV_RELOAD_MARKER_FILE}`;

  let disposed = false;
  let lastMtime: number | null = null;
  let lastSize: number | null = null;
  let pendingReload = false;
  let reloadTimer: number | null = null;

  const scheduleReload = () => {
    if (disposed) return;
    if (pendingReload) return;
    pendingReload = true;

    if (reloadTimer !== null) {
      window.clearTimeout(reloadTimer);
      reloadTimer = null;
    }

    reloadTimer = window.setTimeout(() => {
      reloadTimer = null;
      pendingReload = false;
      void reloadPlugin(plugin, "marker-updated");
    }, 280);
  };

  const poll = async () => {
    if (disposed) return;
    const info = await stat.call(adapter, markerPath).catch(() => null);
    if (!info) return;

    if (lastMtime === null) {
      lastMtime = info.mtime;
      lastSize = info.size;
      return;
    }

    if (info.mtime === lastMtime && info.size === lastSize) return;
    if (info.mtime < lastMtime) {
      lastMtime = info.mtime;
      lastSize = info.size;
      return;
    }

    lastMtime = info.mtime;
    lastSize = info.size;
    scheduleReload();
  };

  const intervalId = window.setInterval(() => {
    void poll();
  }, 700);
  plugin.registerInterval(intervalId);
  void poll();

  return {
    dispose: () => {
      disposed = true;
      if (reloadTimer !== null) {
        window.clearTimeout(reloadTimer);
        reloadTimer = null;
      }
    },
  };
}
