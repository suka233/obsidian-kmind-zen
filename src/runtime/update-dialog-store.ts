import {
  createEmptyKmindUpdateDialogState,
  type KmindUpdateDialogState,
} from "@kmind/app";
import { TFile, TFolder, type App } from "obsidian";

const SETTINGS_DIR = ".kmind-zen";
const UPDATE_DIALOG_STATE_PATH = `${SETTINGS_DIR}/update-dialog-state.json`;

function parseRecordFlagMap(value: unknown): Record<string, true> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, true> = {};
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (flag === true) result[key] = true;
  }
  return result;
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && item.trim()) result[key] = item.trim();
  }
  return result;
}

function parseBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "boolean") result[key] = item;
  }
  return result;
}

function parseUpdateDialogState(text: string): KmindUpdateDialogState {
  try {
    const parsed = JSON.parse(text) as Partial<KmindUpdateDialogState> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return createEmptyKmindUpdateDialogState();
    return {
      initialized: parseBooleanRecord(parsed.initialized),
      lastObservedVersion: parseStringRecord(parsed.lastObservedVersion),
      readVersions: parseRecordFlagMap(parsed.readVersions),
      pendingReminderVersion: parseStringRecord(parsed.pendingReminderVersion),
      noticeExposed: parseRecordFlagMap(parsed.noticeExposed),
      noticeClicked: parseRecordFlagMap(parsed.noticeClicked),
      tutorialExposed: parseRecordFlagMap(parsed.tutorialExposed),
      tutorialClicked: parseRecordFlagMap(parsed.tutorialClicked),
    };
  } catch {
    return createEmptyKmindUpdateDialogState();
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

export async function loadObsidianUpdateDialogState(app: App): Promise<KmindUpdateDialogState> {
  await ensureFolder(app, SETTINGS_DIR);
  const exists = await app.vault.adapter.exists(UPDATE_DIALOG_STATE_PATH).catch(() => false);
  if (!exists) return createEmptyKmindUpdateDialogState();
  const text = await app.vault.adapter.read(UPDATE_DIALOG_STATE_PATH).catch(() => "");
  return parseUpdateDialogState(text);
}

export async function persistObsidianUpdateDialogState(
  app: App,
  next: KmindUpdateDialogState,
): Promise<void> {
  await ensureFolder(app, SETTINGS_DIR);
  await app.vault.adapter.write(UPDATE_DIALOG_STATE_PATH, JSON.stringify(next, null, 2));
}
