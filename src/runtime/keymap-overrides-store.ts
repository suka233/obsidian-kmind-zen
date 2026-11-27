import { normalizeKeymapOverrides, sanitizeReservedKeymapOverrides, type KmindKeymapOverrides } from "@kmind/app";
import { TFile, TFolder, type App } from "obsidian";

type StoredKeymapOverridesV1 = {
  schemaVersion: 1;
  updatedAt: number;
  overrides: KmindKeymapOverrides;
};

const SETTINGS_DIR = ".kmind-zen";
const KEYMAP_PATH = `${SETTINGS_DIR}/keymap-overrides.json`;

let current: KmindKeymapOverrides = {};
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function parse(text: string): KmindKeymapOverrides | null {
  try {
    const parsed = JSON.parse(text) as Partial<StoredKeymapOverridesV1> | null;
    if (!parsed || parsed.schemaVersion !== 1) return null;
    return sanitizeReservedKeymapOverrides(normalizeKeymapOverrides(parsed.overrides));
  } catch {
    return null;
  }
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = String(path ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return;
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing instanceof TFile) throw new Error(`Cannot create folder "${normalized}": a file exists at that path.`);
  if (existing) return;
  try {
    await app.vault.createFolder(normalized);
  } catch (error) {
    const created = app.vault.getAbstractFileByPath(normalized);
    if (created instanceof TFolder) return;
    if (created instanceof TFile) throw new Error(`Cannot create folder "${normalized}": a file exists at that path.`);
    const message = error instanceof Error ? error.message : String(error);
    if (/folder already exists/i.test(message)) return;
    throw error;
  }
}

async function persist(app: App, next: KmindKeymapOverrides) {
  const payload: StoredKeymapOverridesV1 = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    overrides: next,
  };
  await ensureFolder(app, SETTINGS_DIR);
  await app.vault.adapter.write(KEYMAP_PATH, JSON.stringify(payload, null, 2));
}

async function loadOnce(app: App): Promise<void> {
  await ensureFolder(app, SETTINGS_DIR);
  const exists = await app.vault.adapter.exists(KEYMAP_PATH).catch(() => false);
  if (!exists) return;
  const text = await app.vault.adapter.read(KEYMAP_PATH).catch(() => "");
  if (!text) return;
  const parsed = parse(text);
  if (!parsed) return;
  current = parsed;
  emit();
}

export const kmindZenObsidianKeymapOverridesStore = {
  getState: () => current,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  load: async (app: App) => {
    if (!loadPromise) {
      loadPromise = loadOnce(app).catch((error) => {
        console.error("[kmind-zen] load keymap overrides failed:", error);
      });
    }
    await loadPromise;
  },
  set: async (app: App, next: KmindKeymapOverrides) => {
    const resolved = sanitizeReservedKeymapOverrides(next);
    current = resolved;
    emit();
    try {
      await persist(app, resolved);
    } catch (error) {
      console.error("[kmind-zen] save keymap overrides failed:", error);
    }
  },
  reset: async (app: App) => {
    await kmindZenObsidianKeymapOverridesStore.set(app, {});
  },
};

export async function ensureKmindZenObsidianKeymapOverridesLoaded(app: App): Promise<void> {
  await kmindZenObsidianKeymapOverridesStore.load(app);
}
