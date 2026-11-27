import { useEffect, useMemo, useState } from "react";

import type { DocumentId, KmindApp, KmindAppSnapshot, ProjectDurableDiagnostic } from "@kmind/app";
import {
  assertProjectReplacementKeepsWithheldMaps,
  describeWhiteboardReadFailure,
  describeWithheldDocumentWriteRefusal,
  legacyMigrationBackupKind,
  prepareProjectReplacementFromDocsSnapshot,
  prepareProjectReplacementFromPackage,
  prepareProjectReplacementFromYjsUpdate,
  replaceProjectRecordsDurably,
} from "@kmind/app";
import { HistoryPanelView, RecoveryWorkbench } from "@kmind/app-react";
import { useT } from "@kmind/editor-react";
import { Notice, TFile, TFolder, type App } from "obsidian";

import type { KmindPreviewBridge } from "../host/obsidian/create-obsidian-host-adapter";
import { prepareObsidianHistoryRestore } from "../host/obsidian/obsidian-history-restore-lease";
import { applyObsidianHistoryRetention } from "../host/obsidian/obsidian-history-retention";
import { historyThumbnailSources, resolveHistoryThumbnailPath } from "../host/obsidian/obsidian-history-thumbnails";
import {
  buildHistoryCheckpointFileName,
  parseHistoryCheckpointFileName,
  type HistoryCheckpointStorageFormat,
  type HistoryCheckpointTag,
} from "@kmind/host-local";
import { KMIND_ZEN_AUTO_HISTORY_KEEP, KMIND_ZEN_AUTO_HISTORY_MIN_INTERVAL_MINUTES } from "../storage/history-policy";

type SnapshotKind = "checkpoint" | "conflict";

type SnapshotEntry = {
  kind: SnapshotKind;
  path: string;
  fileName: string;
  ts: number;
  device: string;
  tag: HistoryCheckpointTag | "external" | "local" | "device";
  label?: string | null;
  pinned: boolean;
  name: string | null;
  storageFormat: HistoryCheckpointStorageFormat;
};

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
  return parseHistoryCheckpointFileName(String(fileName ?? "")).storageFormat !== "unknown";
}

/** Conflict entries are named `<ts>_conflict_external.*` / `<ts>_conflict_local.*` (older: `-external` / `-local`), and this device's versions `<ts>_conflict_device.*`. */
function deriveTag(fileName: string): SnapshotEntry["tag"] {
  const name = String(fileName ?? "");
  if (name.includes("before-import") || name.includes("before_import")) return "before-import";
  if (name.includes("before-restore") || name.includes("before_restore")) return "before-restore";
  if (name.includes("before-migration") || name.includes("before_migration")) return "before-migration";
  if (name.includes("manual")) return "manual";
  if (/[-_]external(?:\.|$)/u.test(name)) return "external";
  if (/[-_]local(?:\.|$)/u.test(name)) return "local";
  if (/_conflict_device(?:\.|$)/u.test(name)) return "device";
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

function resolveSnapshotLegacyMetaPath(snapshotPath: string): string | null {
  if (isYjsSnapshotPath(snapshotPath)) return snapshotPath.replace(/\.yjs$/i, ".meta.json");
  return null;
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

async function removeFileSafe(app: App, path: string): Promise<void> {
  try {
    await app.vault.adapter.remove(path);
  } catch {
    // ignore
  }
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
  // Migration backups keep an internal English name (their deduplication key); show what they are.
  const entryDisplayName = (entry: { tag?: string | null | undefined; name?: string | null | undefined; label?: string | null | undefined }) => {
    const backupKind = entry.tag === "before-migration" ? legacyMigrationBackupKind(entry.name) : null;
    if (backupKind) return t(`obsidian.history.migrationBackup.${backupKind}`);
    return entry.name ?? entry.label ?? null;
  };
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
  /** Bumped when a thumbnail is written after its entry, so the selected entry's picture is read again. */
  const [thumbnailWrites, setThumbnailWrites] = useState(0);
  useEffect(() => props.preview.subscribeHistoryThumbnails(() => setThumbnailWrites((value) => value + 1)), [props.preview]);
  const [checkpointName, setCheckpointName] = useState("");
  const saveIntegrity = props.app.host.ports.projectSaveIntegrity;
  const [saveDiagnostic, setSaveDiagnostic] = useState<ProjectDurableDiagnostic | null>(
    () => saveIntegrity?.getState().diagnostic ?? null,
  );
  useEffect(() => {
    const update = () => setSaveDiagnostic(saveIntegrity?.getState().diagnostic ?? null);
    const unsubscribe = saveIntegrity?.subscribe(update);
    update();
    return unsubscribe;
  }, [saveIntegrity]);

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
        // The thumbnail next to the entry; a package entry without one shows its own preview slot.
        let sourcePath: string | null = null;
        for (const candidate of historyThumbnailSources(selectedEntry.path)) {
          if (await props.hostApp.vault.adapter.exists(candidate)) {
            sourcePath = candidate;
            break;
          }
        }
        if (disposed) return;
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
  }, [props.hostApp, selectedEntry?.path, selectedEntry?.storageFormat, thumbnailWrites]);

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

  // Another view edits this file: history can be viewed, never changed or restored from here.
  const editLease = props.app.host.ports.projectEditLease;
  const [editable, setEditable] = useState(() => editLease?.getState().editable ?? true);
  useEffect(() => {
    if (!editLease) return undefined;
    const update = () => setEditable(editLease.getState().editable);
    update();
    return editLease.subscribe(update);
  }, [editLease]);

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
    if (!editable) return;
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
      // A manual checkpoint is never deleted automatically, and creating one deletes nothing.
      const created = await props.app.host.ports.projectSnapshots.createPackageCheckpoint({
        tag: "manual",
        pinned: false,
        name: nameRaw ? nameRaw : null,
      });
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
    if (!editable) return;
    if (!projectId) return;
    if (!selectedEntry) return;
    const ok = await props.app.host.ports.dialog.confirm(t("obsidian.history.confirm.delete"));
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      const previewPath = resolveHistoryThumbnailPath(selectedEntry.path);
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
    if (!editable) return;
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
      const prevPreviewPath = resolveHistoryThumbnailPath(selectedEntry.path);
      const nextPreviewPath = resolveHistoryThumbnailPath(nextPath);
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
    if (!editable) return;
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
      initialValue: entryDisplayName(selectedEntry) ?? "",
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
      const prevPreviewPath = resolveHistoryThumbnailPath(selectedEntry.path);
      const nextPreviewPath = resolveHistoryThumbnailPath(nextPath);
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
    if (!editable) return;
    if (!projectId) return;
    if (!selectedEntry) return;
    const ok = await props.app.host.ports.dialog.confirm(t("obsidian.history.confirm.restore"));
    if (!ok) return;
    setLoading(true);
    setError(null);
    let lease: Awaited<ReturnType<typeof prepareObsidianHistoryRestore>> | null = null;
    try {
      lease = await prepareObsidianHistoryRestore(props.hostApp, selectedEntry.path);
      await props.app.dispatch("document.saveNow");
      const sourceBytes = await lease.readVerified();
      const decodeText = () => new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
      // Every format becomes one complete record set; the project keeps its document IDs.
      const prepared = selectedEntry.storageFormat === "docs"
        ? prepareProjectReplacementFromDocsSnapshot({ text: decodeText(), expectedRootDocId: projectId })
        : selectedEntry.storageFormat === "package"
          ? await prepareProjectReplacementFromPackage({ text: decodeText(), expectedRootDocId: projectId })
          : selectedEntry.storageFormat === "yjs"
            ? await prepareProjectReplacementFromYjsUpdate({ update: sourceBytes, expectedRootDocId: projectId, now: Date.now() })
            : null;
      if (!prepared) throw new Error("This history entry has an unknown format.");
      if (!prepared.complete && !await props.app.host.ports.dialog.confirm(t("obsidian.history.confirm.restoreIncomplete"))) return;
      // A map open read-only is never changed (phase-34.24): refused before the safety checkpoint, naming the map.
      await assertProjectReplacementKeepsWithheldMaps(props.app, prepared.records);
      const projectSnapshots = props.app.host.ports.projectSnapshots;
      if (!projectSnapshots?.completePackageCheckpoint) {
        throw new Error("Package checkpoint API is not available in the current host adapter.");
      }
      const checkpoint = await projectSnapshots.createPackageCheckpoint({ tag: "before-restore", pinned: false, name: null });
      lease.protect(checkpoint.path);
      await replaceProjectRecordsDurably(props.app, {
        rootDocId: projectId,
        records: prepared.records,
        operation: "history-restore",
        assets: prepared.assets,
        whiteboardConversions: prepared.whiteboardConversions,
      });
      // Only the before-restore kind is tidied; the restored source is still leased.
      await projectSnapshots.completePackageCheckpoint({ checkpoint, tag: "before-restore", outcome: "success" });
      await refresh();
    } catch (err) {
      // An entry whose whiteboard data this version refuses says why, in the app's language.
      setError(describeWhiteboardReadFailure(props.app.i18n.t, err)
        ?? describeWithheldDocumentWriteRefusal(props.app.i18n.t, err)
        ?? (err instanceof Error ? err.message : "Failed to restore snapshot"));
    } finally {
      lease?.release();
      setLoading(false);
      props.app.focusCanvas();
    }
  };

  const cleanupNow = async () => {
    if (!editable) return;
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      // "Clean up" deletes only automatic snapshots beyond the kept number.
      await applyObsidianHistoryRetention(props.hostApp, projectId, { mode: "auto", autoKeep: keep });
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
          : item.tag === "before-migration"
            ? t("obsidian.history.beforeMigrationTag")
          : item.tag === "before-destructive-save"
            ? t("obsidian.history.beforeDestructiveSaveTag")
          : item.tag === "manual"
            ? t("obsidian.history.tag.manual")
            : item.tag === "auto"
              ? t("obsidian.history.tag.auto")
              : item.tag;
    const tagLabel = item.pinned ? `${t("obsidian.history.tag.pinned")} · ${tagLabelBase}` : tagLabelBase;
    const displayName = entryDisplayName(item);
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
        : item.tag === "device"
          ? t("obsidian.history.tag.device")
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
                disabled: !editable,
                onClick: () => void togglePinSelected(),
              },
              {
                id: "rename",
                label: t("obsidian.history.action.rename"),
                disabled: !editable,
                onClick: () => void renameSelected(),
              },
            ]
          : []),
        {
          id: "delete",
          label: t("obsidian.history.action.delete"),
          disabled: !editable,
          onClick: () => void deleteSelected(),
        },
        {
          id: "restore",
          label: t("obsidian.history.action.restore"),
          disabled: !editable,
          onClick: () => void restoreSelected(),
          tone: "primary" as const,
        },
      ]
    : [];

  return (
    <HistoryPanelView
      recoveryContent={<RecoveryWorkbench app={props.app} diagnostic={saveDiagnostic} translationPrefix="obsidian.recovery" />}
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
      selectedName={selectedEntry ? (entryDisplayName(selectedEntry) ?? selectedEntry.fileName) : undefined}
      selectedNoneLabel={t("obsidian.history.selected.none")}
      selectedTitleLabel={t("obsidian.history.preview.title")}
      subtitle={t("obsidian.history.subtitle", { minutes, keep })}
      title={t("obsidian.history.title")}
      writeActionsDisabled={!editable}
    />
  );
}
