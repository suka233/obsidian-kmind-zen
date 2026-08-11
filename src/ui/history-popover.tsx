import { useEffect, useMemo, useState } from "react";

import type { DocumentId, KmindApp, KmindAppSnapshot } from "@kmind/app";
import {
  buildDocumentZipV1BytesFromKmindzProjectV3,
  importDocumentZipV1BytesToExistingRootDocId,
  parseKmindzProjectV3FromSvgText,
  unsafeGetKmindAppInternal,
} from "@kmind/app";
import { HistoryPanelView } from "@kmind/app-react";
import { useT } from "@kmind/editor-react";
import { Notice, TFile, TFolder, type App } from "obsidian";

import type { KmindPreviewBridge } from "../host/obsidian/create-obsidian-host-adapter";
import { buildHistoryCheckpointFileName, parseHistoryCheckpointFileName, type HistoryCheckpointTag } from "../storage/history-snapshot-filename";
import { KMIND_ZEN_AUTO_HISTORY_KEEP, KMIND_ZEN_AUTO_HISTORY_MIN_INTERVAL_MINUTES } from "../storage/history-policy";

type SnapshotKind = "checkpoint" | "conflict";

type SnapshotStorageFormat = "yjs" | "package" | "unknown";

type SnapshotEntry = {
  kind: SnapshotKind;
  path: string;
  fileName: string;
  ts: number;
  device: string;
  tag: "auto" | "manual" | "before-restore" | "before-import" | "external" | "local" | "unknown";
  label?: string | null;
  pinned: boolean;
  name: string | null;
  storageFormat: SnapshotStorageFormat;
};

function waitForActiveCore(
  app: { subscribe: (listener: () => void) => () => void; getSnapshot: () => { editor: { activeCore: { id?: unknown } | null } } },
  docId: DocumentId,
  options?: { timeoutMs?: number },
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 1500;
  if (app.getSnapshot().editor.activeCore?.id === docId) return Promise.resolve(true);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const unsubscribe = app.subscribe(() => {
      const current = app.getSnapshot().editor.activeCore;
      if (current?.id === docId) {
        unsubscribe();
        resolve(true);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        unsubscribe();
        resolve(false);
      }
    });
  });
}

function normalizeVaultPath(path: string): string {
  return String(path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveProjectDir(rootDocId: DocumentId): string {
  return normalizeVaultPath(`.kmind-zen/projects/${rootDocId}`);
}

function resolveHistoryDir(rootDocId: DocumentId): string {
  return `${resolveProjectDir(rootDocId)}/history`;
}

function resolveCheckpointsDir(rootDocId: DocumentId): string {
  return `${resolveHistoryDir(rootDocId)}/checkpoints`;
}

function resolveConflictsDir(rootDocId: DocumentId): string {
  return `${resolveHistoryDir(rootDocId)}/conflicts`;
}

function isYjsSnapshotPath(snapshotPath: string): boolean {
  return snapshotPath.toLowerCase().endsWith(".yjs");
}

function isHistorySnapshotFileName(fileName: string): boolean {
  const lower = String(fileName ?? "").toLowerCase();
  return lower.endsWith(".yjs") || lower.endsWith(".kmindz.svg");
}

function deriveTag(fileName: string): SnapshotEntry["tag"] {
  const name = String(fileName ?? "");
  if (name.includes("before-import") || name.includes("before_import")) return "before-import";
  if (name.includes("before-restore") || name.includes("before_restore")) return "before-restore";
  if (name.includes("manual")) return "manual";
  if (name.includes("-external")) return "external";
  if (name.includes("-local")) return "local";
  const { ts } = parseHistoryCheckpointFileName(name);
  if (ts !== null) return "auto";
  return "unknown";
}

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function resolveSnapshotPreviewPath(snapshotPath: string): string | null {
  if (isYjsSnapshotPath(snapshotPath)) return snapshotPath.replace(/\.yjs$/i, ".preview.svg");
  return null;
}

function resolveSnapshotLegacyMetaPath(snapshotPath: string): string | null {
  if (isYjsSnapshotPath(snapshotPath)) return snapshotPath.replace(/\.yjs$/i, ".meta.json");
  return null;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
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
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return;
  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    // eslint-disable-next-line no-await-in-loop
    await ensureFolder(app, current);
  }
}

function listFolderFiles(app: App, dir: string): string[] {
  const abstract = app.vault.getAbstractFileByPath(dir);
  if (!(abstract instanceof TFolder)) return [];
  return abstract.children.filter((child): child is TFile => child instanceof TFile).map((child) => child.path);
}

async function listDirFiles(app: App, dir: string): Promise<string[]> {
  const adapter = app.vault.adapter;
  try {
    const listed = await adapter.list(dir);
    return (listed.files ?? []).map(normalizeVaultPath);
  } catch {
    // Fallback to Obsidian's in-memory file tree (may be empty for hidden folders).
    return listFolderFiles(app, dir).map(normalizeVaultPath);
  }
}

async function readBinaryFile(app: App, path: string): Promise<Uint8Array> {
  const adapter = app.vault.adapter as unknown as { readBinary?: ((path: string) => Promise<ArrayBuffer>) | undefined };
  if (typeof adapter.readBinary === "function") {
    const buffer = await adapter.readBinary(path);
    return new Uint8Array(buffer);
  }
  const abstract = app.vault.getAbstractFileByPath(path);
  if (abstract instanceof TFile) {
    const buffer = await app.vault.readBinary(abstract);
    return new Uint8Array(buffer);
  }
  throw new Error(`Failed to read binary file: ${path}`);
}

async function removeFileSafe(app: App, path: string): Promise<void> {
  try {
    await app.vault.adapter.remove(path);
  } catch {
    // ignore
  }
}

async function pruneCheckpoints(app: App, rootDocId: DocumentId, keepCount: number): Promise<void> {
  if (keepCount <= 0) return;
  const dir = resolveCheckpointsDir(rootDocId);
  const files = await listDirFiles(app, dir);
  const parsed = files
    .map((fullPath) => normalizeVaultPath(fullPath))
    .filter((path) => isHistorySnapshotFileName(path))
    .map((path) => {
      const fileName = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
      const snapshot = parseHistoryCheckpointFileName(fileName);
      return { path, ts: snapshot.ts ?? 0, pinned: snapshot.pinned, storageFormat: snapshot.storageFormat };
    })
    .filter((item) => item.ts > 0)
    .sort((a, b) => b.ts - a.ts);

  const toDelete = parsed.filter((item) => !item.pinned).slice(keepCount);
  await Promise.all(
    toDelete.map(async (item) => {
      const previewPath = resolveSnapshotPreviewPath(item.path);
      const metaPath = resolveSnapshotLegacyMetaPath(item.path);
      await Promise.all([
        removeFileSafe(app, item.path),
        previewPath ? removeFileSafe(app, previewPath) : Promise.resolve(undefined),
        metaPath ? removeFileSafe(app, metaPath) : Promise.resolve(undefined),
      ]);
    }),
  );
}

async function listEntries(app: App, rootDocId: DocumentId): Promise<{ checkpoints: SnapshotEntry[]; conflicts: SnapshotEntry[] }> {
  const checkpointsDir = resolveCheckpointsDir(rootDocId);
  const conflictDir = resolveConflictsDir(rootDocId);

  const [checkpointFiles, conflictFiles] = await Promise.all([listDirFiles(app, checkpointsDir), listDirFiles(app, conflictDir)]);

  const normalize = (kind: SnapshotKind, files: string[]): SnapshotEntry[] => {
    const out: SnapshotEntry[] = [];
    for (const fullPath of files) {
      const path = normalizeVaultPath(fullPath);
      if (!isHistorySnapshotFileName(path)) continue;
      const fileName = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
      const parsed = parseHistoryCheckpointFileName(fileName);
      const ts = parsed.ts ?? Date.now();
      const device = parsed.ts ? parsed.deviceId : "";
      const tag = kind === "checkpoint" ? parsed.tag : deriveTag(fileName);
      out.push({
        kind,
        path,
        fileName,
        ts,
        device,
        tag,
        label: kind === "checkpoint" ? parsed.legacyLabel : null,
        pinned: kind === "checkpoint" ? parsed.pinned : false,
        name: kind === "checkpoint" ? parsed.name : null,
        storageFormat: parsed.storageFormat,
      });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  };

  return {
    checkpoints: normalize("checkpoint", checkpointFiles),
    conflicts: normalize("conflict", conflictFiles),
  };
}

export function HistoryPopover(props: {
  hostApp: App;
  file: TFile;
  app: KmindApp;
  preview: KmindPreviewBridge;
  snapshot: KmindAppSnapshot;
  onClose: () => void;
}) {
  const t = useT();
  const activeId = props.snapshot.documents.activeId;
  const projectId = (props.snapshot.navigation.rootId ?? activeId) as DocumentId | null;
  const keep = KMIND_ZEN_AUTO_HISTORY_KEEP;
  const minutes = KMIND_ZEN_AUTO_HISTORY_MIN_INTERVAL_MINUTES;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<SnapshotEntry[]>([]);
  const [conflicts, setConflicts] = useState<SnapshotEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [checkpointName, setCheckpointName] = useState("");
  const internal = unsafeGetKmindAppInternal(props.app);

  const selectedEntry = useMemo(() => {
    if (!selectedPath) return null;
    return checkpoints.find((item) => item.path === selectedPath) ?? conflicts.find((item) => item.path === selectedPath) ?? null;
  }, [checkpoints, conflicts, selectedPath]);

  useEffect(() => {
    let disposed = false;
    let createdUrl: string | null = null;
    setPreviewUrl(null);
    setPreviewLoading(false);

    if (!selectedEntry) return () => {};

    setPreviewLoading(true);
    void (async () => {
      try {
        const sourcePath = selectedEntry.storageFormat === "package"
          ? selectedEntry.path
          : resolveSnapshotPreviewPath(selectedEntry.path);
        if (!sourcePath) throw new Error("Preview is not available for this snapshot.");
        const text = await props.hostApp.vault.adapter.read(sourcePath);
        if (disposed) return;
        const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        createdUrl = url;
        setPreviewUrl(url);
      } catch {
        if (!disposed) setPreviewUrl(null);
      } finally {
        if (!disposed) setPreviewLoading(false);
      }
    })();

    return () => {
      disposed = true;
      if (createdUrl) {
        try {
          URL.revokeObjectURL(createdUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [props.hostApp, selectedEntry?.path, selectedEntry?.storageFormat]);

  const refresh = async (options?: { selectedPath?: string | null }) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listEntries(props.hostApp, projectId);
      setCheckpoints(result.checkpoints);
      setConflicts(result.conflicts);
      const desiredSelectedPath = options?.selectedPath ?? selectedPath;
      if (desiredSelectedPath) {
        const exists = result.checkpoints.some((e) => e.path === desiredSelectedPath) || result.conflicts.some((e) => e.path === desiredSelectedPath);
        if (!exists) setSelectedPath(null);
        else if (options?.selectedPath) setSelectedPath(desiredSelectedPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const canPinHistory = props.snapshot.capabilities.premium.canPinHistory;
  const canRenameHistory = props.snapshot.capabilities.premium.canRenameHistoryPin;
  const canCreateManualCheckpoint = props.snapshot.capabilities.premium.canCreateManualCheckpoint;

  const notifyPremiumRequired = (feature: "pin" | "rename" | "checkpoint") => {
    const label = feature === "pin"
      ? t("obsidian.proFeature.historyPin")
      : feature === "rename"
        ? t("obsidian.proFeature.historyRename")
        : t("obsidian.proFeature.historyCheckpoint");
    new Notice(t("obsidian.notice.proFeatureRequired", { feature: label }), 2800);
  };

  const createCheckpoint = async () => {
    if (!projectId) return;
    if (!canCreateManualCheckpoint) {
      notifyPremiumRequired("checkpoint");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await props.app.dispatch("document.saveNow");
      if (!props.app.host.ports.projectSnapshots) {
        throw new Error("Package checkpoint API is not available in the current host adapter.");
      }

      const nameRaw = checkpointName.trim().slice(0, 80);
      const created = await props.app.host.ports.projectSnapshots.createPackageCheckpoint({
        tag: "manual",
        pinned: false,
        name: nameRaw ? nameRaw : null,
      });
      await pruneCheckpoints(props.hostApp, projectId, keep);
      await refresh({ selectedPath: created.path });
      setSelectedPath(created.path);
      setCheckpointName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create checkpoint");
    } finally {
      setLoading(false);
      props.app.focusCanvas();
    }
  };

  const deleteSelected = async () => {
    if (!projectId) return;
    if (!selectedEntry) return;
    const ok = await props.app.host.ports.dialog.confirm(t("obsidian.history.confirm.delete"));
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      const previewPath = resolveSnapshotPreviewPath(selectedEntry.path);
      const metaPath = resolveSnapshotLegacyMetaPath(selectedEntry.path);
      await removeFileSafe(props.hostApp, selectedEntry.path);
      if (previewPath) await removeFileSafe(props.hostApp, previewPath);
      if (metaPath) await removeFileSafe(props.hostApp, metaPath);
      await refresh();
      setSelectedPath(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete snapshot");
    } finally {
      setLoading(false);
      props.app.focusCanvas();
    }
  };

  const togglePinSelected = async () => {
    if (!projectId) return;
    if (!selectedEntry) return;
    if (selectedEntry.kind !== "checkpoint") return;
    if (!canPinHistory) {
      notifyPremiumRequired("pin");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const dir = selectedEntry.path.split("/").slice(0, -1).join("/");
      const parsed = parseHistoryCheckpointFileName(selectedEntry.fileName);
      if (!parsed.ts) throw new Error("Invalid checkpoint file name.");
      const tag: HistoryCheckpointTag = parsed.tag;
      const nextFileName = buildHistoryCheckpointFileName({
        ts: parsed.ts,
        tag,
        pinned: !selectedEntry.pinned,
        name: selectedEntry.name ?? selectedEntry.label ?? null,
        storageFormat: parsed.storageFormat,
      });
      const nextPath = `${dir}/${nextFileName}`;
      await props.hostApp.vault.adapter.rename(selectedEntry.path, nextPath);
      const prevPreviewPath = resolveSnapshotPreviewPath(selectedEntry.path);
      const nextPreviewPath = resolveSnapshotPreviewPath(nextPath);
      if (prevPreviewPath && nextPreviewPath) {
        await props.hostApp.vault.adapter.rename(prevPreviewPath, nextPreviewPath).catch(() => undefined);
      }
      const prevMetaPath = resolveSnapshotLegacyMetaPath(selectedEntry.path);
      if (prevMetaPath) await removeFileSafe(props.hostApp, prevMetaPath);
      await refresh({ selectedPath: nextPath });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pin checkpoint");
    } finally {
      setLoading(false);
      props.app.focusCanvas();
    }
  };

  const renameSelected = async () => {
    if (!projectId) return;
    if (!selectedEntry) return;
    if (selectedEntry.kind !== "checkpoint") return;
    if (!canRenameHistory) {
      notifyPremiumRequired("rename");
      return;
    }
    const next = await props.app.host.ports.dialog.prompt({
      title: t("obsidian.history.rename.title"),
      message: t("obsidian.history.rename.message"),
      initialValue: selectedEntry.name ?? selectedEntry.label ?? "",
    });
    if (next === null) return;
    setLoading(true);
    setError(null);
    try {
      const name = next.trim().slice(0, 80);
      const dir = selectedEntry.path.split("/").slice(0, -1).join("/");
      const parsed = parseHistoryCheckpointFileName(selectedEntry.fileName);
      if (!parsed.ts) throw new Error("Invalid checkpoint file name.");
      const tag: HistoryCheckpointTag = parsed.tag;
      const nextFileName = buildHistoryCheckpointFileName({
        ts: parsed.ts,
        tag,
        pinned: selectedEntry.pinned,
        name: name ? name : null,
        storageFormat: parsed.storageFormat,
      });
      const nextPath = `${dir}/${nextFileName}`;
      await props.hostApp.vault.adapter.rename(selectedEntry.path, nextPath);
      const prevPreviewPath = resolveSnapshotPreviewPath(selectedEntry.path);
      const nextPreviewPath = resolveSnapshotPreviewPath(nextPath);
      if (prevPreviewPath && nextPreviewPath) {
        await props.hostApp.vault.adapter.rename(prevPreviewPath, nextPreviewPath).catch(() => undefined);
      }
      const prevMetaPath = resolveSnapshotLegacyMetaPath(selectedEntry.path);
      if (prevMetaPath) await removeFileSafe(props.hostApp, prevMetaPath);
      await refresh({ selectedPath: nextPath });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename checkpoint");
    } finally {
      setLoading(false);
      props.app.focusCanvas();
    }
  };

  const restoreSelected = async () => {
    if (!projectId) return;
    if (!selectedEntry) return;
    const ok = await props.app.host.ports.dialog.confirm(t("obsidian.history.confirm.restore"));
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      await props.app.dispatch("document.saveNow");
      const projectSnapshots = props.app.host.ports.projectSnapshots;
      const projectCollab = props.app.host.ports.projectCollab;
      if (!projectSnapshots) {
        throw new Error("Package checkpoint API is not available in the current host adapter.");
      }

      await projectSnapshots.createPackageCheckpoint({ tag: "before-restore", pinned: false, name: null });
      await pruneCheckpoints(props.hostApp, projectId, keep);

      if (selectedEntry.storageFormat === "package") {
        const text = await props.hostApp.vault.adapter.read(selectedEntry.path);
        const payload = parseKmindzProjectV3FromSvgText(text);
        if (!payload) throw new Error("Invalid package checkpoint: missing/invalid v3 payload.");
        const zipBytes = buildDocumentZipV1BytesFromKmindzProjectV3({ payload });
        const assets = props.app.host.ports.assets;
        if (!assets) throw new Error("AssetStore is not available in the current host adapter.");
        await importDocumentZipV1BytesToExistingRootDocId({
          zipBytes,
          targetRootDocId: projectId,
          documents: props.app.host.ports.documents,
          assets,
          dialog: props.app.host.ports.dialog,
          i18n: props.app.i18n,
          storage: props.app.host.ports.storage,
          setDocuments: internal.setDocuments,
          setActiveDocument: internal.setActiveDocument,
          setNavigation: (nav) => internal.setNavigation(nav),
          applyViewState: false,
          preserveTargetRootTitle: true,
          skipImagePolicy: true,
          collab: projectCollab,
        });
      } else {
        const update = await readBinaryFile(props.hostApp, selectedEntry.path);
        if (!projectCollab) {
          throw new Error("Restore API is not available in the current host adapter.");
        }
        await projectCollab.restoreFromYjsUpdate({ update });
      }

      await props.app.dispatch("document.refreshFromStore");
      await props.app.dispatch("submap.resetToRoot");
      const rootDocId = (props.app.getSnapshot().navigation.rootId ?? projectId) as DocumentId;
      await waitForActiveCore(props.app, rootDocId);
      const items = await props.app.host.ports.documents.list();
      const toReload = Array.from(new Set([rootDocId, ...items.map((item) => item.id)]));
      if (toReload.length > 0) {
        await props.app.dispatch("mindmap.reloadDocsFromStore", { docIds: toReload });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore snapshot");
    } finally {
      setLoading(false);
      props.app.focusCanvas();
    }
  };

  const cleanupNow = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      await pruneCheckpoints(props.hostApp, projectId, keep);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cleanup failed");
    } finally {
      setLoading(false);
    }
  };

  const activeTitle = (() => {
    if (!activeId) return "";
    const record = props.snapshot.documents.items.find((item) => item.id === activeId) ?? null;
    return record?.title ?? "";
  })();

  const selectedMeta = selectedEntry
    ? `${formatTs(selectedEntry.ts)}${selectedEntry.device ? ` · ${selectedEntry.device.slice(0, 8)}` : ""}`
    : "";

  const checkpointItems = checkpoints.map((item) => {
    const tagLabelBase =
      item.tag === "before-restore"
        ? t("obsidian.history.beforeRestoreTag")
        : item.tag === "before-import"
          ? t("obsidian.history.beforeImportTag")
          : item.tag === "manual"
            ? t("obsidian.history.tag.manual")
            : item.tag === "auto"
              ? t("obsidian.history.tag.auto")
              : item.tag;
    const tagLabel = item.pinned ? `${t("obsidian.history.tag.pinned")} · ${tagLabelBase}` : tagLabelBase;
    const displayName = item.name ?? item.label ?? null;
    return {
      id: item.path,
      title: `${formatTs(item.ts)}${displayName ? `  ${displayName}` : ""}`,
      meta: tagLabel,
      active: item.path === selectedPath,
      onSelect: () => setSelectedPath(item.path),
      tooltip: item.fileName,
    };
  });

  const conflictItems = conflicts.map((item) => {
    const tagLabel = item.tag === "external"
      ? t("obsidian.history.tag.external")
      : item.tag === "local"
        ? t("obsidian.history.tag.local")
        : item.tag;
    return {
      id: item.path,
      title: formatTs(item.ts),
      meta: tagLabel,
      active: item.path === selectedPath,
      onSelect: () => setSelectedPath(item.path),
      tooltip: item.fileName,
    };
  });

  const selectedActions = selectedEntry
    ? [
        ...(selectedEntry.kind === "checkpoint"
          ? [
              {
                id: "pin",
                label: selectedEntry.pinned ? t("obsidian.history.action.unpin") : t("obsidian.history.action.pin"),
                onClick: () => void togglePinSelected(),
              },
              {
                id: "rename",
                label: t("obsidian.history.action.rename"),
                onClick: () => void renameSelected(),
              },
            ]
          : []),
        {
          id: "delete",
          label: t("obsidian.history.action.delete"),
          onClick: () => void deleteSelected(),
        },
        {
          id: "restore",
          label: t("obsidian.history.action.restore"),
          onClick: () => void restoreSelected(),
          tone: "primary" as const,
        },
      ]
    : [];

  return (
    <HistoryPanelView
      activeTitle={activeTitle}
      checkpointName={checkpointName}
      checkpointNamePlaceholder={t("obsidian.history.checkpointName.placeholder")}
      checkpoints={checkpointItems}
      checkpointsEmptyLabel={t("obsidian.history.empty.checkpoints")}
      checkpointsTitle={t("obsidian.history.section.checkpoints")}
      cleanupLabel={t("obsidian.history.action.cleanup")}
      closeLabel={t("kmind.common.close")}
      conflicts={conflictItems}
      conflictsEmptyLabel={t("obsidian.history.empty.conflicts")}
      conflictsTitle={t("obsidian.history.section.conflicts")}
      createCheckpointLabel={t("obsidian.history.action.createCheckpoint")}
      error={error}
      loading={loading}
      loadingLabel={t("kmind.common.loading")}
      onCheckpointNameChange={setCheckpointName}
      onCheckpointNameSubmit={() => void createCheckpoint()}
      onCleanup={() => void cleanupNow()}
      onClose={props.onClose}
      onRefresh={() => void refresh()}
      previewEmptyLabel={t("obsidian.history.preview.empty")}
      previewLoading={previewLoading}
      previewLoadingLabel={t("obsidian.history.preview.loading")}
      previewTitle={t("obsidian.history.preview.title")}
      previewUrl={previewUrl}
      refreshLabel={t("obsidian.history.action.refresh")}
      selectedActions={selectedActions}
      selectedFileName={selectedEntry?.fileName}
      selectedKindLabel={selectedEntry ? `${selectedEntry.kind === "conflict" ? t("obsidian.history.section.conflicts") : t("obsidian.history.section.checkpoints")}${selectedEntry.kind === "checkpoint" && selectedEntry.pinned ? ` · ${t("obsidian.history.tag.pinned")}` : ""}` : undefined}
      selectedMeta={selectedMeta}
      selectedName={selectedEntry ? (selectedEntry.name ?? selectedEntry.label ?? selectedEntry.fileName) : undefined}
      selectedNoneLabel={t("obsidian.history.selected.none")}
      selectedTitleLabel={t("obsidian.history.preview.title")}
      subtitle={t("obsidian.history.subtitle", { minutes, keep })}
      title={t("obsidian.history.title")}
    />
  );
}
