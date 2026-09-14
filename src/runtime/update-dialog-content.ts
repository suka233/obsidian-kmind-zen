import type {
  KmindOfficialContentFeed,
  KmindReleaseChangelogItem,
  KmindUpdateHost,
  KmindUpdateLocale,
} from "@kmind/app";
import { normalizeKmindOfficialContent } from "@kmind/app";

import {
  OBSIDIAN_UPDATE_DIALOG_RELEASES_EN,
  OBSIDIAN_UPDATE_DIALOG_RELEASES_ZH,
} from "./generated-update-changelog";

export function resolvePluginUpdateLocale(locale: string): KmindUpdateLocale {
  return String(locale ?? "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function apiBase(): string {
  return String(__KMIND_ZEN_API_BASE__ ?? "").trim().replace(/\/+$/, "");
}

function normalizeFeedPayload(payload: unknown): KmindOfficialContentFeed {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Official content response must be an object.");
  }
  const record = payload as { notices?: unknown; tutorials?: unknown; serverTime?: unknown };
  if (!Array.isArray(record.notices)) throw new Error("Official content notices must be an array.");
  if (!Array.isArray(record.tutorials)) throw new Error("Official content tutorials must be an array.");
  const notices = record.notices.map((item) => {
    const normalized = normalizeKmindOfficialContent(item);
    if (!normalized.ok) throw new Error(normalized.errors.join("\n"));
    if (normalized.content.type !== "notice") throw new Error("Official content notice type mismatch.");
    return normalized.content;
  });
  const tutorials = record.tutorials.map((item) => {
    const normalized = normalizeKmindOfficialContent(item);
    if (!normalized.ok) throw new Error(normalized.errors.join("\n"));
    if (normalized.content.type !== "tutorial") throw new Error("Official content tutorial type mismatch.");
    return normalized.content;
  });
  const serverTime = typeof record.serverTime === "string" && record.serverTime.trim()
    ? record.serverTime.trim()
    : new Date().toISOString();
  return { notices, tutorials, serverTime };
}

export function listObsidianUpdateDialogReleases(locale: KmindUpdateLocale): KmindReleaseChangelogItem[] {
  return locale === "en-US" ? OBSIDIAN_UPDATE_DIALOG_RELEASES_EN : OBSIDIAN_UPDATE_DIALOG_RELEASES_ZH;
}

export async function fetchObsidianUpdateOfficialContent(args: {
  locale: KmindUpdateLocale;
  version: string;
}): Promise<KmindOfficialContentFeed> {
  const url = new URL("/api/plugin-official-content", `${apiBase()}/`);
  url.searchParams.set("host", "obsidian" satisfies KmindUpdateHost);
  url.searchParams.set("locale", args.locale);
  url.searchParams.set("version", args.version);
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Official content request failed: ${response.status}`);
  }
  return normalizeFeedPayload(await response.json());
}
