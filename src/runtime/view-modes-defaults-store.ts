import type { ViewModesDefaultsStore } from "@kmind/app";
import { TFile, TFolder, type App } from "obsidian";

export type CanvasDragMode = "pan-first" | "select-first";

export type KmindZenViewModesDefaults = {
  zenMode: boolean;
  readOnly: boolean;
  showAddChildButton: boolean;
  showNodeMenuTrigger: boolean;
  imageCompressionEnabled: boolean;
  canvasDragMode: CanvasDragMode;
  canvasInteractionTipShown: boolean;
  interactiveGuideSeenVersion: number;
};

type StoredSettingsV1 = {
  schemaVersion: 1;
  updatedAt: number;
  viewModes: {
    zenMode: boolean;
    readOnly: boolean;
  };
  nodeEntryControls?: {
    showAddChildButton?: boolean | undefined;
    showNodeMenuTrigger?: boolean | undefined;
  } | undefined;
  imageCompression?: {
    enabled?: boolean | undefined;
  } | undefined;
  canvasInteraction?: {
    dragMode?: CanvasDragMode | undefined;
    tipShown?: boolean | undefined;
  } | undefined;
  guide?: {
    interactiveGuideSeenVersion?: number | undefined;
  } | undefined;
};

const SETTINGS_DIR = ".kmind-zen";
const SETTINGS_PATH = `${SETTINGS_DIR}/settings.json`;
const LEGACY_DEFAULTS: KmindZenViewModesDefaults = {
  zenMode: false,
  readOnly: false,
  showAddChildButton: true,
  showNodeMenuTrigger: true,
  imageCompressionEnabled: true,
  canvasDragMode: "pan-first",
  canvasInteractionTipShown: false,
  interactiveGuideSeenVersion: 0,
};
const FRESH_DEFAULTS: KmindZenViewModesDefaults = {
  ...LEGACY_DEFAULTS,
  canvasDragMode: "select-first",
  canvasInteractionTipShown: true,
};

let current: KmindZenViewModesDefaults = { ...LEGACY_DEFAULTS };
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function parse(text: string): KmindZenViewModesDefaults | null {
  try {
    const parsed = JSON.parse(text) as Partial<StoredSettingsV1> | null;
    if (!parsed || parsed.schemaVersion !== 1) return null;
    const viewModes = parsed.viewModes as Partial<Pick<KmindZenViewModesDefaults, "zenMode" | "readOnly">> | null | undefined;
    const nodeEntryControls =
      parsed.nodeEntryControls as Partial<Pick<KmindZenViewModesDefaults, "showAddChildButton" | "showNodeMenuTrigger">> | null | undefined;
    const imageCompression = parsed.imageCompression as { enabled?: unknown } | null | undefined;
    const canvasInteraction = parsed.canvasInteraction as { dragMode?: unknown; tipShown?: unknown } | null | undefined;
    const guide = parsed.guide as { interactiveGuideSeenVersion?: unknown } | null | undefined;
    const canvasDragMode = canvasInteraction?.dragMode === "pan-first" || canvasInteraction?.dragMode === "select-first"
      ? canvasInteraction.dragMode
      : LEGACY_DEFAULTS.canvasDragMode;
    return {
      zenMode: typeof viewModes?.zenMode === "boolean" ? viewModes.zenMode : LEGACY_DEFAULTS.zenMode,
      readOnly: typeof viewModes?.readOnly === "boolean" ? viewModes.readOnly : LEGACY_DEFAULTS.readOnly,
      showAddChildButton: typeof nodeEntryControls?.showAddChildButton === "boolean" ? nodeEntryControls.showAddChildButton : LEGACY_DEFAULTS.showAddChildButton,
      showNodeMenuTrigger: typeof nodeEntryControls?.showNodeMenuTrigger === "boolean" ? nodeEntryControls.showNodeMenuTrigger : LEGACY_DEFAULTS.showNodeMenuTrigger,
      imageCompressionEnabled: typeof imageCompression?.enabled === "boolean" ? imageCompression.enabled : LEGACY_DEFAULTS.imageCompressionEnabled,
      canvasDragMode,
      canvasInteractionTipShown: typeof canvasInteraction?.tipShown === "boolean" ? canvasInteraction.tipShown : false,
      interactiveGuideSeenVersion: typeof guide?.interactiveGuideSeenVersion === "number" && Number.isFinite(guide.interactiveGuideSeenVersion)
        ? Math.max(0, Math.floor(guide.interactiveGuideSeenVersion))
        : LEGACY_DEFAULTS.interactiveGuideSeenVersion,
    };
  } catch {
    return null;
  }
}

function hasExistingKmindFiles(app: App): boolean {
  try {
    return app.vault.getFiles().some((file) => file.extension === "kmindz");
  } catch {
    return true;
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

async function ensureDir(app: App, path: string): Promise<void> {
  const normalized = String(path ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return;
  const parts = normalized.split("/").filter(Boolean);
  let currentPath = "";
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    // eslint-disable-next-line no-await-in-loop
    await ensureFolder(app, currentPath);
  }
}

async function persist(app: App, next: KmindZenViewModesDefaults) {
  const payload: StoredSettingsV1 = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    viewModes: {
      zenMode: next.zenMode,
      readOnly: next.readOnly,
    },
    nodeEntryControls: {
      showAddChildButton: next.showAddChildButton,
      showNodeMenuTrigger: next.showNodeMenuTrigger,
    },
    imageCompression: {
      enabled: next.imageCompressionEnabled,
    },
    canvasInteraction: {
      dragMode: next.canvasDragMode,
      tipShown: next.canvasInteractionTipShown,
    },
    guide: {
      interactiveGuideSeenVersion: next.interactiveGuideSeenVersion,
    },
  };
  await ensureDir(app, SETTINGS_DIR);
  await app.vault.adapter.write(SETTINGS_PATH, JSON.stringify(payload, null, 2));
}

async function loadOnce(app: App): Promise<void> {
  await ensureDir(app, SETTINGS_DIR);

  const exists = await app.vault.adapter.exists(SETTINGS_PATH).catch(() => false);
  if (!exists) {
    current = hasExistingKmindFiles(app) ? { ...LEGACY_DEFAULTS } : { ...FRESH_DEFAULTS };
    emit();
    return;
  }

  const text = await app.vault.adapter.read(SETTINGS_PATH).catch(() => "");
  if (!text) return;

  const parsed = parse(text);
  if (!parsed) return;

  current = parsed;
  emit();
}

export const kmindZenViewModesDefaultsStore: ViewModesDefaultsStore & {
  load: (app: App) => Promise<void>;
  set: (app: App, next: Partial<KmindZenViewModesDefaults>) => Promise<void>;
  getState: () => KmindZenViewModesDefaults;
  shouldShowCanvasInteractionTip: () => boolean;
  markCanvasInteractionTipShown: (app: App) => Promise<void>;
} = {
  get: () => current,
  getState: () => current,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  load: async (app) => {
    if (!loadPromise) {
      loadPromise = loadOnce(app).catch((error) => {
        console.error("[kmind-zen] load settings failed:", error);
      });
    }
    await loadPromise;
  },
  set: async (app, next) => {
    const resolved: KmindZenViewModesDefaults = {
      zenMode: typeof next.zenMode === "boolean" ? next.zenMode : current.zenMode,
      readOnly: typeof next.readOnly === "boolean" ? next.readOnly : current.readOnly,
      showAddChildButton: typeof next.showAddChildButton === "boolean" ? next.showAddChildButton : current.showAddChildButton,
      showNodeMenuTrigger: typeof next.showNodeMenuTrigger === "boolean" ? next.showNodeMenuTrigger : current.showNodeMenuTrigger,
      imageCompressionEnabled: typeof next.imageCompressionEnabled === "boolean" ? next.imageCompressionEnabled : current.imageCompressionEnabled,
      canvasDragMode: next.canvasDragMode === "pan-first" || next.canvasDragMode === "select-first" ? next.canvasDragMode : current.canvasDragMode,
      canvasInteractionTipShown: typeof next.canvasInteractionTipShown === "boolean" ? next.canvasInteractionTipShown : current.canvasInteractionTipShown,
      interactiveGuideSeenVersion: typeof next.interactiveGuideSeenVersion === "number" && Number.isFinite(next.interactiveGuideSeenVersion)
        ? Math.max(0, Math.floor(next.interactiveGuideSeenVersion))
        : current.interactiveGuideSeenVersion,
    };
    if (
      resolved.zenMode === current.zenMode
      && resolved.readOnly === current.readOnly
      && resolved.showAddChildButton === current.showAddChildButton
      && resolved.showNodeMenuTrigger === current.showNodeMenuTrigger
      && resolved.imageCompressionEnabled === current.imageCompressionEnabled
      && resolved.canvasDragMode === current.canvasDragMode
      && resolved.canvasInteractionTipShown === current.canvasInteractionTipShown
      && resolved.interactiveGuideSeenVersion === current.interactiveGuideSeenVersion
    ) {
      return;
    }
    current = resolved;
    emit();
    try {
      await persist(app, resolved);
    } catch (error) {
      console.error("[kmind-zen] save settings failed:", error);
    }
  },
  shouldShowCanvasInteractionTip: () => current.canvasDragMode === "pan-first" && !current.canvasInteractionTipShown,
  markCanvasInteractionTipShown: async (app) => {
    await kmindZenViewModesDefaultsStore.set(app, { canvasInteractionTipShown: true });
  },
};

export async function ensureKmindZenViewModesDefaultsLoaded(app: App): Promise<void> {
  await kmindZenViewModesDefaultsStore.load(app);
}
