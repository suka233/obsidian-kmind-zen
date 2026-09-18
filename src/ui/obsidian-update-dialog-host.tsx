import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { App } from "obsidian";
import { Notice } from "obsidian";

import type {
  KmindOfficialContent,
  KmindOfficialContentFeed,
  KmindUpdateDialogState,
  KmindUpdateLocale,
} from "@kmind/app";
import {
  buildKmindOfficialContentStateKey,
  markKmindUpdatePendingReminder,
  markKmindUpdateVersionRead,
  recordKmindOfficialContentState,
  resolveKmindUpdateDialogStartup,
  validateKmindPluginUrl,
} from "@kmind/app";
import { KmindUpdateDialog, type KmindUpdateOfficialContentStatus } from "@kmind/app-react";

import { resolveObsidianLocale } from "../i18n/ui-i18n";
import { fetchObsidianUpdateOfficialContent, listObsidianUpdateDialogReleases, resolvePluginUpdateLocale } from "../runtime/update-dialog-content";
import { loadObsidianUpdateDialogState, persistObsidianUpdateDialogState } from "../runtime/update-dialog-store";
import rawIconSvg from "../assets/kmind-adjusted.svg?raw";

const UPDATE_DIALOG_HOST_ID = "kmind-zen-obsidian-update-dialog-host";

type UpdateDialogController = {
  maybeAutoOpen: (app: App) => Promise<void>;
  openManually: (app: App) => Promise<void>;
  markCurrentVersionReadSilently: (app: App) => Promise<void>;
};

let hostEl: HTMLDivElement | null = null;
let root: Root | null = null;
let controller: UpdateDialogController | null = null;
let pendingControllerCalls: Array<(next: UpdateDialogController) => void> = [];

function resolveKmindWebsitePath(path: string): string {
  const base = String(__KMIND_ZEN_WEBSITE_URL__ ?? "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("__KMIND_ZEN_WEBSITE_URL__ is required.");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function resolveObsidianChangelogPath(locale: KmindUpdateLocale): string {
  const localeSegment = locale === "en-US" ? "en" : "zh";
  return `/${localeSegment}/changelog/obsidian/${__KMIND_ZEN_APP_VERSION__}`;
}

function resolveObsidianUpdateDialogTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  if (document.body.classList.contains("theme-dark")) return "dark";
  if (document.documentElement.classList.contains("theme-dark")) return "dark";
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function renderKmindUpdateDialogIcon() {
  return (
    <span
      aria-hidden="true"
      className="kmind-update-dialog__icon-mark"
      dangerouslySetInnerHTML={{ __html: rawIconSvg }}
    />
  );
}

function openExternalUrl(url: string): void {
  if (typeof window === "undefined") return;
  const errors = validateKmindPluginUrl(url);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  window.open(url, "_blank", "noopener,noreferrer");
}

function hasRecordedOfficialContentState(
  state: KmindUpdateDialogState,
  content: KmindOfficialContent,
  action: "exposed" | "clicked",
): boolean {
  const key = buildKmindOfficialContentStateKey(content.type, action, "obsidian", content.id);
  if (content.type === "notice" && action === "exposed") return state.noticeExposed[key] === true;
  if (content.type === "notice" && action === "clicked") return state.noticeClicked[key] === true;
  if (content.type === "tutorial" && action === "exposed") return state.tutorialExposed[key] === true;
  return state.tutorialClicked[key] === true;
}

function UpdateDialogHostApp(props: { onReady: (next: UpdateDialogController | null) => void }) {
  const { onReady } = props;
  const hostAppRef = useRef<App | null>(null);
  const startupCheckedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState<KmindUpdateLocale>(() => resolvePluginUpdateLocale(resolveObsidianLocale()));
  const [state, setState] = useState<KmindUpdateDialogState | null>(null);
  const stateRef = useRef<KmindUpdateDialogState | null>(null);
  const [officialContent, setOfficialContent] = useState<KmindOfficialContentFeed | null>(null);
  const [officialContentStatus, setOfficialContentStatus] = useState<KmindUpdateOfficialContentStatus>("idle");
  const [officialContentError, setOfficialContentError] = useState<string | null>(null);
  const [officialContentRetryNonce, setOfficialContentRetryNonce] = useState(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const persistNextState = useCallback((next: KmindUpdateDialogState) => {
    const app = hostAppRef.current;
    if (!app) return;
    stateRef.current = next;
    setState(next);
    void persistObsidianUpdateDialogState(app, next).catch((error) => {
      console.error("[kmind-zen] failed to persist update dialog state:", error);
      new Notice("KMind Zen: failed to save update dialog state.", 3600);
    });
  }, []);

  const loadStartupState = useCallback(async (app: App) => {
    hostAppRef.current = app;
    const stored = await loadObsidianUpdateDialogState(app);
    const startup = resolveKmindUpdateDialogStartup({
      state: stored,
      host: "obsidian",
      currentVersion: __KMIND_ZEN_APP_VERSION__,
    });
    await persistObsidianUpdateDialogState(app, startup.state);
    stateRef.current = startup.state;
    setState(startup.state);
    return startup;
  }, []);

  const ensureCurrentState = useCallback(async (app: App) => {
    hostAppRef.current = app;
    if (stateRef.current) return stateRef.current;
    const startup = await loadStartupState(app);
    return startup.state;
  }, [loadStartupState]);

  const updateDialogStateWith = useCallback((updater: (current: KmindUpdateDialogState) => KmindUpdateDialogState) => {
    const current = stateRef.current;
    if (!current) return;
    const next = updater(current);
    if (next === current) return;
    persistNextState(next);
  }, [persistNextState]);

  const maybeAutoOpen = useCallback(async (app: App) => {
    if (startupCheckedRef.current) return;
    startupCheckedRef.current = true;
    const startup = await loadStartupState(app);
    if (startup.shouldOpen) setOpen(true);
  }, [loadStartupState]);

  const openManually = useCallback(async (app: App) => {
    startupCheckedRef.current = true;
    await ensureCurrentState(app);
    setLocale(resolvePluginUpdateLocale(resolveObsidianLocale()));
    setOpen(true);
  }, [ensureCurrentState]);

  const markCurrentVersionReadSilently = useCallback(async (app: App) => {
    startupCheckedRef.current = true;
    const current = await ensureCurrentState(app);
    const next = markKmindUpdateVersionRead(current, "obsidian", __KMIND_ZEN_APP_VERSION__);
    persistNextState(next);
  }, [ensureCurrentState, persistNextState]);

  useEffect(() => {
    const next: UpdateDialogController = { maybeAutoOpen, openManually, markCurrentVersionReadSilently };
    onReady(next);
    return () => onReady(null);
  }, [markCurrentVersionReadSilently, maybeAutoOpen, onReady, openManually]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setOfficialContentStatus("loading");
    setOfficialContentError(null);
    void fetchObsidianUpdateOfficialContent({
      locale,
      version: __KMIND_ZEN_APP_VERSION__,
    })
      .then((feed) => {
        if (cancelled) return;
        setOfficialContent(feed);
        setOfficialContentStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setOfficialContent(null);
        setOfficialContentError(message || "Official content failed to load.");
        setOfficialContentStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [officialContentRetryNonce, locale, open]);

  const remindLater = useCallback(() => {
    updateDialogStateWith((current) => markKmindUpdatePendingReminder(current, "obsidian", __KMIND_ZEN_APP_VERSION__));
    setOpen(false);
  }, [updateDialogStateWith]);

  const acknowledge = useCallback(() => {
    updateDialogStateWith((current) => markKmindUpdateVersionRead(current, "obsidian", __KMIND_ZEN_APP_VERSION__));
    setOpen(false);
  }, [updateDialogStateWith]);

  const openChangelog = useCallback(() => {
    try {
      openExternalUrl(resolveKmindWebsitePath(resolveObsidianChangelogPath(locale)));
    } catch (error) {
      console.error("[kmind-zen] failed to open changelog:", error);
      new Notice("KMind Zen: failed to open changelog.", 3600);
    }
  }, [locale]);

  const recordOfficialContent = useCallback((content: KmindOfficialContent, action: "exposed" | "clicked") => {
    updateDialogStateWith((current) => {
      if (hasRecordedOfficialContentState(current, content, action)) return current;
      return recordKmindOfficialContentState(current, content.type, action, "obsidian", content.id);
    });
  }, [updateDialogStateWith]);

  const openOfficialContent = useCallback((content: KmindOfficialContent) => {
    recordOfficialContent(content, "clicked");
    try {
      openExternalUrl(content.ctaUrl);
    } catch (error) {
      console.error("[kmind-zen] failed to open official content:", error);
      new Notice("KMind Zen: failed to open official content.", 3600);
    }
  }, [recordOfficialContent]);

  if (!open || !state) return null;

  return (
    <KmindUpdateDialog
      currentVersion={__KMIND_ZEN_APP_VERSION__}
      host="obsidian"
      icon={renderKmindUpdateDialogIcon()}
      locale={locale}
      officialContent={officialContent}
      officialContentError={officialContentError}
      officialContentStatus={officialContentStatus}
      onAcknowledge={acknowledge}
      onClose={remindLater}
      onLocaleChange={setLocale}
      onOfficialContentVisible={(content) => recordOfficialContent(content, "exposed")}
      onOpenChangelog={openChangelog}
      onOpenOfficialContent={openOfficialContent}
      onRemindLater={remindLater}
      onRetryOfficialContent={() => setOfficialContentRetryNonce((value) => value + 1)}
      releases={listObsidianUpdateDialogReleases(locale)}
      theme={resolveObsidianUpdateDialogTheme()}
    />
  );
}

function ensureUpdateDialogHost(): void {
  if (typeof document === "undefined") return;
  if (root && hostEl) return;
  const existing = document.getElementById(UPDATE_DIALOG_HOST_ID);
  const host = existing instanceof HTMLDivElement ? existing : document.createElement("div");
  host.id = UPDATE_DIALOG_HOST_ID;
  if (!host.parentElement) document.body.appendChild(host);
  hostEl = host;
  root = createRoot(host);
  root.render(
    <UpdateDialogHostApp
      onReady={(next) => {
        controller = next;
        if (!next) return;
        const pending = pendingControllerCalls;
        pendingControllerCalls = [];
        for (const call of pending) call(next);
      }}
    />,
  );
}

function runWithController(call: (next: UpdateDialogController) => void): void {
  ensureUpdateDialogHost();
  if (controller) {
    call(controller);
    return;
  }
  pendingControllerCalls.push(call);
}

export function maybeAutoOpenKmindZenObsidianUpdateDialog(app: App): void {
  runWithController((next) => {
    void next.maybeAutoOpen(app).catch((error) => {
      console.error("[kmind-zen] failed to auto open update dialog:", error);
      new Notice("KMind Zen: failed to initialize update dialog.", 3600);
    });
  });
}

export function openKmindZenObsidianUpdateDialog(app: App): void {
  runWithController((next) => {
    void next.openManually(app).catch((error) => {
      console.error("[kmind-zen] failed to open update dialog:", error);
      new Notice("KMind Zen: failed to open update dialog.", 3600);
    });
  });
}

export function markKmindZenObsidianUpdateDialogCurrentVersionRead(app: App): void {
  runWithController((next) => {
    void next.markCurrentVersionReadSilently(app).catch((error) => {
      console.error("[kmind-zen] failed to mark update dialog read:", error);
      new Notice("KMind Zen: failed to save update dialog state.", 3600);
    });
  });
}

export function destroyKmindZenObsidianUpdateDialog(): void {
  pendingControllerCalls = [];
  controller = null;
  try {
    root?.unmount();
  } catch {
    // ignore
  } finally {
    root = null;
  }
  try {
    hostEl?.remove();
  } catch {
    // ignore
  } finally {
    hostEl = null;
  }
}
