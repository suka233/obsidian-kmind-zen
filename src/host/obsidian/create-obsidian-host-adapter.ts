import { observeDiagnosticOperation, annotateDiagnosticError } from "@kmind/app";
import { projectProtectionError } from "@kmind/app";
import type {
  AssetRecord,
  AssetStore,
  AssetUrlPort,
  DocumentId,
  DocumentRecord,
  DocumentStore,
  ExternalPort,
  KeyValueStoragePort,
  KmindCapabilities,
  KmindHostAdapter,
  KmindzProjectSvgHeaderV3,
  KmindzProjectSvgPayloadV3,
  KmindzSvgAssetEntryWithSizeV1,
  LegacyCollaborationBlockClassification,
  ProjectDiskSyncPort,
  ProjectDiskVersion,
  ProjectLegacyCollaborationNotice,
  ProjectRecordsPort,
  ProjectSafetyMaintenanceWarning,
  ProjectSnapshotsPort,
  ProjectCheckpointTag,
  ProjectDurableDescriptor,
  ProjectExternalAssetReadRequest,
  ProjectSaveIntegrityPort,
  WhiteboardConversionPort,
} from "@kmind/app";
import {
  ProjectUnusedAssetPolicy,
  classifyLegacyCollaborationBlock,
  inspectProjectDurableSnapshot,
  stableProjectJson,
  externalAssetExtFromMimeType,
  planProjectManifestBootstrap,
  legacyCollaborationBlockRequiresBackup,
  legacyCollaborationBlockRestorableUpdate,
  legacyMigrationBackupName,
  encodeProjectDocsSnapshotV1,
  createProjectConflictSnapshotIndex,
  planLocalVersionSnapshotRetention,
  projectConflictSnapshotFileName,
  projectRecordsContentFingerprint,
  projectTextFingerprint,
  type ProjectConflictSnapshotIndex,
  type ProjectConflictSnapshotSide,
  readCompatibleProjectSource,
  requiresLegacyProjectMigration,
  buildPreservedProjectAssetPack,
  createProjectAssetPackWithExtensions,
  sha256HexText,
  serializeProjectDocumentSemantics,
  ProjectSaveIOError,
  collectDocumentAssetStorageMeta,
  assertMindMapDocumentProseMirrorCanonical,
  compressStaticRasterImageBytesToWebp,
  createBrowserClipboardPort,
  createClipboardEventWriteItems,
  createZipStore,
  decodeBase64,
  DEFAULT_LOCAL_IMAGE_COMPRESSION_POLICY,
  encodeBase64,
  encodeKmindzProjectV3IntoSvgText,
  formatImageCompressionSize,
  isStaticRasterImageMimeType,
  normalizeMindMapExternalAssetStorage,
  normalizeMindMapDocumentProseMirrorContent,
  parseKmindzProjectV3FromSvgText,
  projectContentIdentity,
  readDocumentPackDocuments,
  readDocumentPackSchemaVersion,
  readZipStore,
  resolveDefaultExternalUrlBehavior,
  resolveDocumentPackSchemaVersion,
  resolveKmindzProjectHeaderVersion,
  shouldNotifyImageCompression,
  shouldStoreCompressedImageResult,
  upsertDocumentAssetStorageMeta,
  fillMissingDocumentAssetStorageMeta,
  isWithheldDocumentWriteError,
  projectDocumentMetaOf,
  rememberWithheldDocumentMeta,
  withheldDocumentWriteError,
  waitForRevisionPreviewBackgroundStart,
  type DocumentPackSchemaVersion,
  type WhiteboardDocumentConversion,
} from "@kmind/app";
import {
  buildHistoryCheckpointFileName,
  encodeLegacyCollaborationNoticeRecord,
  legacyCollaborationNoticeRecordKey,
  parseHistoryCheckpointFileName,
  resolveLegacyCollaborationNoticeOnOpen,
} from "@kmind/host-local";
import { assertWhiteboardPersistenceContract, isWithheldWhiteboardSource, type AssetId, type MindMapDocument, type MindMapDocumentInput } from "@kmind/core";
import { Notice, TFile, TFolder, type App, type TAbstractFile } from "obsidian";

import { sha256Hex, sha256HexFromString } from "../../storage/hash";
import { OBSIDIAN_MAP_PLACEHOLDER_SVG } from "../../storage/placeholder-preview-svg";
import { createObsidianProjectRecovery } from "./obsidian-project-recovery";
import { resolveObsidianSafetyDirectory, writeObsidianProjectSafely } from "./obsidian-safe-project-write";
import { cleanupObsidianCompletedTransactions } from "./obsidian-completed-transaction-cleanup";
import { assertDocumentAssetsMatchManifest, inspectObsidianProjectIntegrity } from "./obsidian-project-integrity";
import { prepareObsidianLegacyAssets } from "./obsidian-legacy-assets";
import { createObsidianSaveIntegrity } from "./obsidian-save-integrity";
import { ObsidianSaveConflictError } from "./obsidian-save-conflict";
import { ObsidianReadOnlyViewError } from "./obsidian-read-only-view-error";
import { isObsidianEditorWrite, recordObsidianEditorWrite, recordObsidianEditorWriteIntent } from "./obsidian-editor-writes";
import { trashObsidianProjectSafely } from "./obsidian-safe-project-delete";
import { isObsidianHistoryFileProtected } from "./obsidian-history-restore-lease";
import { applyObsidianHistoryRetention } from "./obsidian-history-retention";
import { resolveHistoryThumbnailPath } from "./obsidian-history-thumbnails";
import { KMIND_ZEN_AUTO_HISTORY_KEEP, KMIND_ZEN_AUTO_HISTORY_MIN_INTERVAL_MS } from "../../storage/history-policy";

import { createObsidianDialogPort } from "./obsidian-dialog";
import { createObsidianUiI18n } from "../../i18n/ui-i18n";
import { createObsidianFilesPort, createObsidianRecoverySourcePicker } from "./obsidian-files";
import { buildObsidianKmindStorageKey, OBSIDIAN_KMIND_STORAGE_PREFIX } from "./obsidian-storage-key";
import { bytesToArrayBuffer } from "../../storage/array-buffer";
import { kmindZenViewModesDefaultsStore } from "../../runtime/view-modes-defaults-store";
import type { ObsidianEditLease } from "../../runtime/obsidian-edit-lease";

/**
 * Thumbnails for the history panel. Map files carry no rendered preview since phase-25.7: a
 * thumbnail is a portable export of the map in view, written next to its history entry.
 */
export type KmindPreviewBridge = {
  setHistoryExporter: (exporter: (() => Promise<string | null>) | null) => void;
  /** Null when no view exports, or when the export fails. */
  exportHistorySvg: () => Promise<string | null>;
  /** An open history panel re-reads its thumbnail when one is written after its entry. */
  subscribeHistoryThumbnails: (listener: () => void) => () => void;
  notifyHistoryThumbnail: () => void;
};

type CreateObsidianHostAdapterResult = {
  host: KmindHostAdapter;
  preview: KmindPreviewBridge;
  lifecycle: { beginClose: () => void; hasPendingWrites: () => boolean; whenWritesIdle: () => Promise<void>; prepareTakeover: () => Promise<void> };
};

type PreparedAssetRecord = {
  mimeType: string;
  bytes: Uint8Array;
  width?: number | undefined;
  height?: number | undefined;
};

/** In Obsidian's interface language, as the rest of the plugin. */
function showImageCompressionNotice(args: {
  kind: "compressed" | "oversize" | "failed";
  originalSizeBytes?: number | undefined;
  compressedSizeBytes?: number | undefined;
}): void {
  const { t } = createObsidianUiI18n();
  const sizes = typeof args.originalSizeBytes === "number" && typeof args.compressedSizeBytes === "number"
    ? { from: formatImageCompressionSize(args.originalSizeBytes), to: formatImageCompressionSize(args.compressedSizeBytes) }
    : null;
  const message = args.kind !== "failed" && sizes
    ? t(`obsidian.imageCompression.notice.${args.kind}`, sizes)
    : t("obsidian.imageCompression.notice.failed");
  new Notice(`KMind Zen: ${message}`, 3200);
}

async function prepareAssetForStorage(record: AssetRecord): Promise<PreparedAssetRecord> {
  const mimeType = String(record.mimeType ?? "").trim() || "application/octet-stream";
  const skipPolicy = record.skipImagePolicy === true;
  if (skipPolicy || !kmindZenViewModesDefaultsStore.getState().imageCompressionEnabled || !isStaticRasterImageMimeType(mimeType)) {
    return { mimeType: record.mimeType, bytes: record.bytes };
  }

  try {
    const compressed = await compressStaticRasterImageBytesToWebp({
      bytes: record.bytes,
      mimeType,
      policy: DEFAULT_LOCAL_IMAGE_COMPRESSION_POLICY,
    });
    if (!shouldStoreCompressedImageResult(compressed)) {
      if (record.bytes.byteLength > DEFAULT_LOCAL_IMAGE_COMPRESSION_POLICY.maxBytes) {
        showImageCompressionNotice({ kind: "failed" });
      }
      return { mimeType: record.mimeType, bytes: record.bytes };
    }
    if (compressed.exceedsMaxBytes) {
      showImageCompressionNotice({
        kind: "oversize",
        originalSizeBytes: compressed.originalSizeBytes,
        compressedSizeBytes: compressed.compressedSizeBytes,
      });
    } else if (shouldNotifyImageCompression(compressed)) {
      showImageCompressionNotice({
        kind: "compressed",
        originalSizeBytes: compressed.originalSizeBytes,
        compressedSizeBytes: compressed.compressedSizeBytes,
      });
    }
    return {
      mimeType: compressed.mimeType,
      bytes: compressed.bytes,
      width: compressed.width,
      height: compressed.height,
    };
  } catch {
    showImageCompressionNotice({ kind: "failed" });
    return { mimeType: record.mimeType, bytes: record.bytes };
  }
}

async function readText(app: App, file: TFile): Promise<string> {
  return app.vault.read(file);
}

function createPreviewBridge(): KmindPreviewBridge {
  let historyExporter: (() => Promise<string | null>) | null = null;
  const thumbnailListeners = new Set<() => void>();
  return {
    setHistoryExporter(next) {
      historyExporter = next;
    },
    async exportHistorySvg() {
      try {
        return historyExporter ? await historyExporter() : null;
      } catch {
        return null;
      }
    },
    subscribeHistoryThumbnails(listener) {
      thumbnailListeners.add(listener);
      return () => { thumbnailListeners.delete(listener); };
    },
    notifyHistoryThumbnail() {
      for (const listener of [...thumbnailListeners]) listener();
    },
  };
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

function normalizeVaultPath(path: string): string {
  return String(path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveProjectDir(rootDocId: DocumentId): string {
  return normalizeVaultPath(`.kmind-zen/projects/${rootDocId}`);
}

function resolveAssetsDir(rootDocId: DocumentId): string {
  return `${resolveProjectDir(rootDocId)}/assets`;
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

async function readObsidianBinaryFile(
  app: App,
  path: string,
  options?: { suppressErrors?: boolean | undefined },
): Promise<Uint8Array | null> {
  const abstract: TAbstractFile | null = app.vault.getAbstractFileByPath(path) as TAbstractFile | null;
  if (abstract instanceof TFile) {
    const buffer = await app.vault.readBinary(abstract);
    return new Uint8Array(buffer);
  }

  const adapter = app.vault.adapter;
  if (typeof adapter.readBinary !== "function") return null;
  try {
    if (typeof adapter.exists === "function" && !(await adapter.exists(path))) return null;
    const buffer = await adapter.readBinary(path);
    return new Uint8Array(buffer);
  } catch (error) {
    if (options?.suppressErrors === false) throw error;
    return null;
  }
}

type AssetIndexEntry = {
  entry: KmindzSvgAssetEntryWithSizeV1;
};

type AssetIndex = {
  byAssetId: Map<AssetId, AssetIndexEntry>;
  knownContentHashes: Set<string>;
  upsert: (assetId: AssetId, args: { entry: KmindzSvgAssetEntryWithSizeV1 }) => void;
  loadFromManifest: (manifest: Record<AssetId, KmindzSvgAssetEntryWithSizeV1>) => void;
  get: (assetId: AssetId) => AssetIndexEntry | null;
  remove: (assetId: AssetId) => void;
};

function createAssetIndex(): AssetIndex {
  const byAssetId = new Map<AssetId, AssetIndexEntry>();
  const knownContentHashes = new Set<string>();

  return {
    byAssetId,
    knownContentHashes,
    upsert(assetId, args) {
      byAssetId.set(assetId, { entry: args.entry });
      knownContentHashes.add(args.entry.contentHash);
    },
    loadFromManifest(manifest) {
      for (const [assetId, entry] of Object.entries(manifest) as Array<[AssetId, KmindzSvgAssetEntryWithSizeV1]>) {
        byAssetId.set(assetId, { entry });
        knownContentHashes.add(entry.contentHash);
      }
    },
    get(assetId) {
      return byAssetId.get(assetId) ?? null;
    },
    remove(assetId) {
      byAssetId.delete(assetId);
    },
  };
}

function createLocalStoragePort(prefix = OBSIDIAN_KMIND_STORAGE_PREFIX): KeyValueStoragePort {
  return {
    getItem(key) {
      try {
        return window.localStorage.getItem(buildObsidianKmindStorageKey(key, prefix));
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        window.localStorage.setItem(buildObsidianKmindStorageKey(key, prefix), value);
      } catch {
        // ignore
      }
    },
    removeItem(key) {
      try {
        window.localStorage.removeItem(buildObsidianKmindStorageKey(key, prefix));
      } catch {
        // ignore
      }
    },
  };
}

function createExternalPort(): ExternalPort {
  return {
    async openUrl(url) {
      try {
        window.open(url);
      } catch {
        // ignore
      }
    },
    resolveUrlBehavior(url) {
      return resolveDefaultExternalUrlBehavior(url);
    },
  };
}

/** Observe writes without changing their ordering or error ownership. Reads never hold quit. */
function createObsidianPendingWrites() {
  const pending = new Set<Promise<void>>();
  return {
    track<T>(operation: () => Promise<T>): Promise<T> {
      const result = operation();
      const settled = result.then(() => {}, () => {});
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
      return result;
    },
    hasPending: () => pending.size > 0,
    async whenIdle() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

function createObsidianProjectAssetStore(args: {
  app: App;
  ensureLoaded: () => Promise<void>;
  rootDocIdRef: { value: DocumentId | null };
  assetsIndex: AssetIndex;
  legacyAssets: Map<string, Uint8Array>;
  trackWrite: ReturnType<typeof createObsidianPendingWrites>["track"];
}): AssetStore {
  const memoryById = new Map<AssetId, { mimeType: string; bytes: Uint8Array }>();

  const ensureAssetsDirReady = async (rootDocId: DocumentId): Promise<void> => {
    await ensureDir(args.app, resolveAssetsDir(rootDocId));
  };

  const resolveAssetFile = (rootDocId: DocumentId, entry: KmindzSvgAssetEntryWithSizeV1): string => {
    return `${resolveAssetsDir(rootDocId)}/${entry.contentHash}.${entry.ext}`;
  };

  const writeBinaryFileIfMissing = async (path: string, bytes: Uint8Array): Promise<void> => {
    const existing = args.app.vault.getAbstractFileByPath(path) as TAbstractFile | null;
    if (existing) return;
    try {
      await args.app.vault.createBinary(path, bytesToArrayBuffer(bytes));
    } catch (error) {
      const created = args.app.vault.getAbstractFileByPath(path) as TAbstractFile | null;
      if (created instanceof TFile) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/already exists/i.test(message)) return;
      throw error;
    }
  };

  return {
    async list() {
      await args.ensureLoaded();
      return Array.from(args.assetsIndex.byAssetId.entries()).map(([id, indexed]) => ({
        id,
        mimeType: indexed.entry.mimeType,
        size: indexed.entry.size,
      }));
    },
    async get(id) {
      await args.ensureLoaded();
      const rootDocId = args.rootDocIdRef.value;
      if (!rootDocId) return null;
      const indexed = args.assetsIndex.get(id);
      if (!indexed) return null;
      const path = resolveAssetFile(rootDocId, indexed.entry);
      const bytes = await readObsidianBinaryFile(args.app, path) ?? args.legacyAssets.get(path);
      if (bytes) {
        memoryById.delete(id);
        return { id, mimeType: indexed.entry.mimeType, bytes } satisfies AssetRecord;
      }
      const cached = memoryById.get(id) ?? null;
      if (!cached) return null;
      return { id, mimeType: cached.mimeType, bytes: cached.bytes } satisfies AssetRecord;
    },
    put: (record) => args.trackWrite(async () => {
      await args.ensureLoaded();
      const rootDocId = args.rootDocIdRef.value;
      if (!rootDocId) throw new Error("Project is not initialized.");
      await ensureAssetsDirReady(rootDocId);

      const stored = await prepareAssetForStorage(record);
      const ext = externalAssetExtFromMimeType(stored.mimeType);
      const contentHash = await sha256Hex(stored.bytes);
      const entry: KmindzSvgAssetEntryWithSizeV1 = { mimeType: stored.mimeType, contentHash, ext, size: stored.bytes.length };
      const path = resolveAssetFile(rootDocId, entry);
      await writeBinaryFileIfMissing(path, stored.bytes);
      args.assetsIndex.upsert(record.id, { entry });
      memoryById.set(record.id, { mimeType: stored.mimeType, bytes: stored.bytes });
      return {
        storage: { kind: "external-v1", contentHash, ext, size: stored.bytes.length } as const,
        mimeType: stored.mimeType,
        ...(typeof stored.width === "number" ? { width: stored.width } : {}),
        ...(typeof stored.height === "number" ? { height: stored.height } : {}),
        sizeBytes: stored.bytes.length,
      };
    }),
    async delete(id) {
      await args.ensureLoaded();
      args.assetsIndex.remove(id);
      memoryById.delete(id);
    },
  };
}

function createObsidianAssetUrlPort(args: { assets: AssetStore; assetsIndex: AssetIndex }): AssetUrlPort {
  const cache = new Map<AssetId, { url: string; contentHash: string }>();

  return {
    async getObjectUrl(id) {
      const indexed = args.assetsIndex.get(id);
      if (!indexed) return null;

      const cached = cache.get(id);
      if (cached && cached.contentHash === indexed.entry.contentHash) return cached.url;
      if (cached) {
        try {
          URL.revokeObjectURL(cached.url);
        } catch {
          // ignore
        }
        cache.delete(id);
      }

      const record = await args.assets.get(id);
      if (!record) return null;
      const blob = new Blob([new Uint8Array(record.bytes)], { type: record.mimeType });
      const url = URL.createObjectURL(blob);
      cache.set(id, { url, contentHash: indexed.entry.contentHash });
      return url;
    },
    revokeObjectUrl(url) {
      for (const [assetId, cached] of Array.from(cache.entries())) {
        if (cached.url !== url) continue;
        cache.delete(assetId);
      }
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Completes a loaded root's project manifest in memory only: opening never writes the file,
 * and the first real save persists the manifest with the rest of the project.
 */
async function withProjectManifestBootstrap(
  rootDocId: DocumentId,
  records: ReadonlyMap<DocumentId, DocumentRecord>,
): Promise<ReadonlyMap<DocumentId, DocumentRecord>> {
  // A root map opened read-only keeps its original exactly as read: no manifest is added (phase-34.24).
  const root = records.get(rootDocId);
  if (root && isWithheldWhiteboardSource(root.doc)) return records;
  const plan = await planProjectManifestBootstrap({ rootId: rootDocId, getRecord: (id) => records.get(id) ?? null });
  if (!plan) return records;
  return new Map(records).set(rootDocId, { ...plan.rootRecord, doc: plan.doc });
}

function createProjectDocumentStore(args: {
  app: App;
  file: TFile;
  preview: KmindPreviewBridge;
  assetsIndex: AssetIndex;
  legacyAssets: Map<string, Uint8Array>;
  /** False while another runtime of this file holds the edit lease. */
  isEditable: () => boolean;
  /**
   * This device's local storage (never synced): it keeps the record that this device backed up a
   * map's legacy collaboration data, so the notice survives the rewrite that removed the Yjs block.
   */
  deviceStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /**
   * The file's text as the runtime read it to open the view (phase-25.9): the first load uses it
   * instead of reading the file again. Later loads (after the root map was deleted) read.
   */
  openingText?: string | null | undefined;
}): DocumentStore {
  /** A runtime without the edit lease never writes the project file or its history. */
  const assertEditable = () => {
    if (!args.isEditable()) throw new ObsidianReadOnlyViewError();
  };
  type DocsPackManifest = {
    schemaVersion: DocumentPackSchemaVersion;
    rootDocId: string;
    documents: Array<{ id: string; title: string; path: string }>;
  };
  /** A package's documents as the read boundary gives them (`readDocsPack`). */
  type DocsPackRead = Readonly<{
    records: readonly DocumentRecord[];
    /** Documents whose early whiteboard data the load boundary converted. */
    conversions: readonly WhiteboardDocumentConversion[];
  }>;

  type AssetsPackIndexV1 = {
    schemaVersion: 1;
    assets: Record<AssetId, { mimeType: string; contentHash: string; ext: string; size: number; path: string }>;
  };

  const UTF8_ENCODER = new TextEncoder();
  const UTF8_DECODER = new TextDecoder();
  const encodeUtf8 = (text: string) => UTF8_ENCODER.encode(text);
  const decodeUtf8 = (bytes: Uint8Array) => UTF8_DECODER.decode(bytes);

  /** JSON is the only source of truth: a legacy Yjs block never blocks or steers reading. */
  const readProjectSource = async (text: string): Promise<KmindzProjectSvgPayloadV3 | null> =>
    (await readCompatibleProjectSource(text, { documentsCanonical: true }))?.payload ?? null;

  const rootDocIdRef = { value: null as DocumentId | null };
  let unusedAssetPolicy = new ProjectUnusedAssetPolicy({ retainInvalidBytes: true });
  const saveIntegrity = createObsidianSaveIntegrity(() => rootDocIdRef.value, {
    readCurrent: () => readText(args.app, args.file),
    validateCurrent: async text => {
      const payload = await readProjectSource(text);
      if (!payload) throw new Error("Retry source is invalid.");
      await inspectProjectText(text, payload, "session");
    },
    async adoptCandidate(text) {
      const payload = await readProjectSource(text);
      if (!payload) throw new Error("Committed retry candidate is invalid.");
      const descriptor = await inspectProjectText(text, payload, "session");
      setSaveBaseline(text, payload, descriptor);
      recordObsidianEditorWrite(args.file, descriptor.fullFileFingerprint);
    },
  });
  const expectedProjectRev = { value: null as string | null };
  let expectedProjectFingerprint: string | null = null;
  let durableDescriptor: ProjectDurableDescriptor | null = null;
  /**
   * The save baseline's exact text and parsed package (phase-25.8): the only bytes the next write
   * may replace, and what the next candidate is built from. The file is not read before a write.
   */
  let baselineText: string | null = null;
  let baselinePayload: KmindzProjectSvgPayloadV3 | null = null;
  /** Advances with every save-baseline change; a prepared disk version adopts only onto the baseline it was read against. */
  let baselineToken = 0;
  /** Content identity of the save baseline (`projectContentIdentity`): what the bytes may not change at the same revision. */
  let baselineContentIdentity: string | null = null;
  /**
   * The image package of every checked version: its manifest entries whose bytes are missing, cut
   * short or changed (permitted anomalies). Every other entry's bytes were verified (phase-25.9).
   */
  const checkedAssetPackages = new WeakMap<KmindzProjectSvgPayloadV3, ReadonlySet<string>>();
  /** The save baseline's invalid image-package entries; its other entries hold verified bytes. */
  let baselineInvalidAssets: ReadonlySet<string> = new Set();
  /**
   * Whether the next write checks if the baseline needs a migration backup first (phase-25.9:
   * decided when a version is read or adopted; a version this session wrote never does).
   */
  let baselineBackupCheck = true;
  /** A verified version of the file becomes the save baseline in one step. */
  const setSaveBaseline = (text: string, payload: KmindzProjectSvgPayloadV3, descriptor: ProjectDurableDescriptor, backupCheck = true): void => {
    const invalidAssets = checkedAssetPackages.get(payload);
    if (!invalidAssets) throw new Error("The save baseline's image package was not checked.");
    baselineText = text;
    baselinePayload = payload;
    expectedProjectRev.value = payload.header.rev;
    expectedProjectFingerprint = descriptor.fullFileFingerprint;
    durableDescriptor = descriptor;
    baselineContentIdentity = projectContentIdentity(payload);
    baselineInvalidAssets = invalidAssets;
    baselineBackupCheck = backupCheck;
    baselineToken += 1;
  };
  /**
   * An image whose exact bytes (this asset, content hash, extension and size) the save baseline's
   * package holds verified: a save neither reads nor hashes it again (phase-25.9).
   */
  const isVerifiedInBaseline = (request: ProjectExternalAssetReadRequest): boolean => {
    const entry = baselinePayload?.header.assetsManifest?.[request.assetId];
    return Boolean(entry) && !baselineInvalidAssets.has(request.assetId)
      && entry!.contentHash.toLowerCase() === request.storage.contentHash
      && entry!.ext.toLowerCase() === request.storage.ext
      && (request.storage.size === undefined || request.storage.size === entry!.size);
  };
  /**
   * The bytes the save baseline's image package holds for an asset, or null. The package is
   * decoded on the first lookup and kept only by the caller (one save): a save that keeps the
   * package never decodes it.
   */
  const openBaselineAssetPackage = (): ((assetId: AssetId) => Uint8Array | null) => {
    const payload = baselinePayload;
    let opened: { files: Map<string, Uint8Array>; index: Partial<AssetsPackIndexV1> | null } | null = null;
    return (assetId) => {
      if (!payload) throw new Error("Project baseline is not loaded.");
      if (!opened) {
        const files = payload.assetsZipB64 ? readZipStore(decodeBase64(payload.assetsZipB64)) : new Map<string, Uint8Array>();
        const indexBytes = files.get("index.json");
        opened = { files, index: indexBytes ? JSON.parse(decodeUtf8(indexBytes)) as Partial<AssetsPackIndexV1> : null };
      }
      const path = opened.index?.assets?.[assetId]?.path;
      return path ? opened.files.get(path) ?? null : null;
    };
  };
  /** Documents as this session read or wrote them: a save asserts only the others (phase-25.9). */
  const persistedDocuments = new WeakSet<object>();
  const cachedById = new Map<DocumentId, DocumentRecord>();
  let loaded = false;
  let legacyPending = false;
  /**
   * Documents of the version this session loaded or adopted whose early whiteboard data the read
   * boundary converted (phase-34.5): the app shows their notice once, and the file holding that
   * version is kept as the pinned migration backup before the first write replaces it.
   */
  let sessionWhiteboardConversions: readonly WhiteboardDocumentConversion[] = [];
  /** The Yjs block classification of the loaded or adopted file, keyed by its full-file fingerprint. */
  let loadedCollaboration: { fingerprint: string; classification: LegacyCollaborationBlockClassification } | null = null;

  let writeQueue: Promise<void> = Promise.resolve();
  const pendingWrites = createObsidianPendingWrites();
  let closing = false;
  const enqueueWrite = async <T>(task: () => Promise<T>, writes = true): Promise<T> => {
    const next = writeQueue.catch(() => {}).then(task).catch(error => {
      // An ordinary concurrent edit is resolved by the conflict dialog; a read-only view's refused
      // write and a refused write to a map opened read-only (phase-34.24) changed nothing; only
      // unsafe states quarantine.
      if (!(error instanceof ObsidianSaveConflictError) && !(error instanceof ObsidianReadOnlyViewError) && !isWithheldDocumentWriteError(error)
        && saveIntegrity.port.getState().mode !== "quarantine" && !saveIntegrity.port.getState().retry) saveIntegrity.quarantine();
      throw error;
    });
    writeQueue = next.then(() => {}, () => {});
    return writes ? pendingWrites.track(() => next) : next;
  };

  const ensureProjectStorageDirs = async (rootDocId: DocumentId): Promise<void> => {
    await ensureDir(args.app, resolveProjectDir(rootDocId));
    await ensureDir(args.app, resolveAssetsDir(rootDocId));
    await ensureDir(args.app, resolveHistoryDir(rootDocId));
    await ensureDir(args.app, resolveCheckpointsDir(rootDocId));
    await ensureDir(args.app, resolveConflictsDir(rootDocId));
  };

  /**
   * The file's safety directory, made sure of once per session: again after the file was renamed,
   * and after a write failed (the directory may have gone).
   */
  let safetyDirectory: { path: string; directory: string } | null = null;
  const ensureSafetyDirectory = async (): Promise<string> => {
    if (safetyDirectory?.path === args.file.path) return safetyDirectory.directory;
    const path = args.file.path;
    const directory = await resolveObsidianSafetyDirectory(path);
    // Desktop and mobile adapters both create missing parents.
    if (!await args.app.vault.adapter.exists(directory)) await args.app.vault.adapter.mkdir(directory);
    safetyDirectory = { path, directory };
    return directory;
  };

  const serializeAssetsManifest = (manifest: Record<AssetId, KmindzSvgAssetEntryWithSizeV1> | undefined): string => {
    if (!manifest || Object.keys(manifest).length === 0) return "[]";
    return JSON.stringify(
      Object.keys(manifest)
        .sort((a, b) => a.localeCompare(b))
        .map((id) => [id, manifest[id as AssetId]] as const),
    );
  };

  const writeBinaryFile = async (path: string, bytes: Uint8Array): Promise<void> => {
    const adapter = args.app.vault.adapter as unknown as { writeBinary?: ((path: string, data: ArrayBuffer) => Promise<void>) | undefined };
    if (typeof adapter.writeBinary === "function") {
      await adapter.writeBinary(path, bytesToArrayBuffer(bytes));
      return;
    }
    await args.app.vault.createBinary(path, bytesToArrayBuffer(bytes));
  };

  const readBinaryFile = async (path: string): Promise<Uint8Array> => {
    const adapter = args.app.vault.adapter as unknown as { readBinary?: ((path: string) => Promise<ArrayBuffer>) | undefined };
    if (typeof adapter.readBinary === "function") {
      const buffer = await adapter.readBinary(path);
      return new Uint8Array(buffer);
    }
    const abstract = args.app.vault.getAbstractFileByPath(path);
    if (abstract instanceof TFile) {
      const buffer = await args.app.vault.readBinary(abstract);
      return new Uint8Array(buffer);
    }
    throw new Error(`Failed to read binary file: ${path}`);
  };

  const writeTextFileSafe = async (path: string, text: string): Promise<void> => {
    try {
      await args.app.vault.adapter.write(path, text);
    } catch {
      // ignore
    }
  };

  /** Evidence files are never overwritten and must read back byte-for-byte. */
  const writeVerifiedHistoryFile = async (path: string, content: string | Uint8Array): Promise<void> => {
    // Hidden plugin files are not indexed TFiles; use the adapter with a unique path.
    if (await args.app.vault.adapter.exists(path)) throw new Error(`History file path is occupied: ${path}`);
    if (typeof content === "string") {
      await args.app.vault.adapter.write(path, content);
      if (await args.app.vault.adapter.read(path) !== content) throw new Error(`History file failed exact read-back verification: ${path}`);
      return;
    }
    await writeBinaryFile(path, content);
    const actual = await readBinaryFile(path);
    if (actual.length !== content.length || actual.some((byte, index) => byte !== content[index])) {
      throw new Error(`History file failed exact read-back verification: ${path}`);
    }
  };


  const listConflictFileNames = async (rootDocId: DocumentId): Promise<string[]> => {
    const dir = resolveConflictsDir(rootDocId);
    if (!await args.app.vault.adapter.exists(dir)) return [];
    const listed = await args.app.vault.adapter.list(dir);
    return (listed.files ?? []).map((path) => normalizeVaultPath(path)).map((path) => path.slice(path.lastIndexOf("/") + 1));
  };

  let conflictIndex: { rootDocId: DocumentId; index: ProjectConflictSnapshotIndex } | null = null;
  /** Conflict-group snapshots of this project by content, each file read once per session. */
  const conflictIndexFor = (rootDocId: DocumentId): ProjectConflictSnapshotIndex => {
    if (conflictIndex?.rootDocId !== rootDocId) {
      const dir = resolveConflictsDir(rootDocId);
      conflictIndex = { rootDocId, index: createProjectConflictSnapshotIndex({
        listFileNames: () => listConflictFileNames(rootDocId),
        readText: (fileName) => args.app.vault.adapter.read(`${dir}/${fileName}`),
      }) };
    }
    return conflictIndex.index;
  };

  /** Writes and verifies one conflict-group snapshot under a free name; the index then knows its content. */
  const writeConflictGroupFile = async (
    rootDocId: DocumentId, side: ProjectConflictSnapshotSide, at: number, text: string, fingerprint: string,
  ): Promise<string> => {
    const existing = new Set(await listConflictFileNames(rootDocId));
    let fileName = projectConflictSnapshotFileName(side, at);
    for (let attempt = 1; existing.has(fileName); attempt += 1) {
      if (attempt >= 10_000) throw new Error("Unable to allocate a unique conflict snapshot file name.");
      fileName = projectConflictSnapshotFileName(side, at + attempt);
    }
    await writeVerifiedHistoryFile(`${resolveConflictsDir(rootDocId)}/${fileName}`, text);
    conflictIndexFor(rootDocId).remember(fileName, fingerprint);
    return fileName;
  };

  /**
   * A JSON history snapshot names its images by content hash and never carries them: before one
   * is written, every image it references is in the project's asset directory, as listed now. One
   * missing there is written from memory first (a file of the old hash writers before its first
   * save, or a verified package: `packageBytes`) and read back; one that is in neither fails the
   * snapshot. `skip`: images the snapshot may name without bytes (permitted anomalies). Callers
   * have made the project's storage directories (`ensureProjectStorageDirs`).
   */
  const writeSnapshotAssets = async (
    rootDocId: DocumentId,
    records: readonly DocumentRecord[],
    sources?: {
      packageBytes?: ((assetId: AssetId) => Uint8Array | null) | undefined;
      skip?: ((assetId: AssetId) => boolean) | undefined;
    },
  ): Promise<void> => {
    const directory = resolveAssetsDir(rootDocId);
    const wanted = new Map<string, { assetId: AssetId; docId: DocumentId; contentHash: string }>();
    for (const record of records) {
      for (const [assetId, { storage }] of collectDocumentAssetStorageMeta(record.doc)) {
        if (sources?.skip?.(assetId)) continue;
        wanted.set(`${directory}/${storage.contentHash}.${storage.ext}`, { assetId, docId: record.id, contentHash: storage.contentHash });
      }
    }
    if (!wanted.size) return;
    const listed = new Set((await args.app.vault.adapter.list(directory)).files.map(normalizeVaultPath));
    for (const [path, image] of wanted) {
      if (listed.has(path)) continue;
      const bytes = args.legacyAssets.get(path) ?? sources?.packageBytes?.(image.assetId) ?? null;
      if (!bytes || await sha256Hex(bytes) !== image.contentHash) {
        throw projectProtectionError("assets-invalid", `Image ${image.assetId} of document ${image.docId} is neither in the project's asset directory nor in memory; the history snapshot is not written.`);
      }
      await args.app.vault.createBinary(path, bytesToArrayBuffer(bytes));
      if (await sha256Hex(new Uint8Array(await args.app.vault.adapter.readBinary(path))) !== image.contentHash) {
        throw projectProtectionError("assets-invalid", `Image ${image.assetId} of document ${image.docId} failed read-back verification; the history snapshot is not written.`);
      }
    }
  };

  /** The newest automatic snapshot's time, read once per session; it spaces automatic history. */
  const autoHistoryCache = { loaded: false, latestTs: 0 };

  const ensureAutoHistoryCache = async (rootDocId: DocumentId): Promise<void> => {
    if (autoHistoryCache.loaded) return;
    await ensureProjectStorageDirs(rootDocId);
    const listed = await args.app.vault.adapter.list(resolveCheckpointsDir(rootDocId));
    for (const fullPath of listed.files ?? []) {
      const path = normalizeVaultPath(fullPath);
      const parsed = parseHistoryCheckpointFileName(path.slice(path.lastIndexOf("/") + 1));
      // Automatic snapshots of both formats share one schedule.
      if (parsed.ts === null || parsed.tag !== "auto" || (parsed.storageFormat !== "yjs" && parsed.storageFormat !== "docs")) continue;
      if (parsed.ts > autoHistoryCache.latestTs) autoHistoryCache.latestTs = parsed.ts;
    }
    autoHistoryCache.loaded = true;
  };

  const maybeWriteAutoHistorySnapshot = async (args2: {
    rootDocId: DocumentId;
    records: readonly DocumentRecord[];
    now: number;
  }): Promise<string | null> => {
    await ensureAutoHistoryCache(args2.rootDocId);

    const latestTs = autoHistoryCache.latestTs;
    const shouldWrite = latestTs === 0 || args2.now - latestTs >= KMIND_ZEN_AUTO_HISTORY_MIN_INTERVAL_MS;
    if (!shouldWrite) return null;
    // A save no longer reads its images (phase-25.9), so the snapshot makes sure of them itself
    // (F4): one missing from the asset directory is written from the package just saved.
    await writeSnapshotAssets(args2.rootDocId, args2.records, {
      packageBytes: openBaselineAssetPackage(),
      skip: assetId => unusedAssetPolicy.permitsAnomaly(assetId),
    });

    const path = `${resolveCheckpointsDir(args2.rootDocId)}/${buildHistoryCheckpointFileName({
      ts: args2.now, tag: "auto", pinned: false, name: null, storageFormat: "docs",
    })}`;
    await args.app.vault.adapter.write(path, encodeProjectDocsSnapshotV1({
      rootDocId: args2.rootDocId, capturedAt: args2.now, records: args2.records,
    }));
    if (args2.now > autoHistoryCache.latestTs) autoHistoryCache.latestTs = args2.now;
    await applyObsidianHistoryRetention(args.app, args2.rootDocId, { mode: "auto", autoKeep: KMIND_ZEN_AUTO_HISTORY_KEEP });
    return path;
  };

  const buildEmbeddedAssetStorageMap = (manifest: Record<AssetId, KmindzSvgAssetEntryWithSizeV1> | undefined): Map<AssetId, NonNullable<ReturnType<typeof normalizeMindMapExternalAssetStorage>>> => {
    const out = new Map<AssetId, NonNullable<ReturnType<typeof normalizeMindMapExternalAssetStorage>>>();
    if (!manifest) return out;
    for (const [assetId, entry] of Object.entries(manifest) as Array<[AssetId, KmindzSvgAssetEntryWithSizeV1]>) {
      const storage = normalizeMindMapExternalAssetStorage({ kind: "external-v1", contentHash: entry.contentHash, ext: entry.ext, size: entry.size });
      if (!storage) continue;
      out.set(assetId, storage);
    }
    return out;
  };

  const injectEmbeddedAssetStorageIntoDocs = (docs: Map<DocumentId, DocumentRecord>, manifest: Record<AssetId, KmindzSvgAssetEntryWithSizeV1> | undefined): Map<DocumentId, DocumentRecord> => {
    const storageMetaByAssetId = buildEmbeddedAssetStorageMap(manifest);
    if (storageMetaByAssetId.size === 0) return docs;
    for (const [docId, record] of docs.entries()) {
      // A map opened read-only keeps its original exactly as read (phase-34.24): see `assetViewOf`.
      if (isWithheldWhiteboardSource(record.doc)) continue;
      const nextDoc = upsertDocumentAssetStorageMeta(record.doc, storageMetaByAssetId);
      if (nextDoc !== record.doc) docs.set(docId, { ...record, doc: nextDoc });
    }
    return docs;
  };

  /** The storage of the session's indexed images (the project's manifest as loaded). */
  const indexedAssetStorage = (): ReturnType<typeof buildEmbeddedAssetStorageMap> => buildEmbeddedAssetStorageMap(
    Object.fromEntries([...args.assetsIndex.byAssetId].map(([assetId, indexed]) => [assetId, indexed.entry])) as Record<AssetId, KmindzSvgAssetEntryWithSizeV1>,
  );

  /**
   * The record of a map opened read-only as the image index and the image checks see it
   * (phase-34.24): its original gets no storage injected, so the images it declares without one are
   * given the manifest's storage in a copy used only to index and check them, never written. Every
   * other record is itself.
   */
  const assetViewOf = (record: DocumentRecord, storageByAssetId: () => ReturnType<typeof buildEmbeddedAssetStorageMap>): DocumentRecord => {
    if (!isWithheldWhiteboardSource(record.doc)) return record;
    const doc = fillMissingDocumentAssetStorageMeta(record.doc, storageByAssetId());
    return doc === record.doc ? record : { ...record, doc };
  };

  const rebuildAssetIndexFromRecords = (records: Iterable<DocumentRecord>): void => {
    const previous = new Map(args.assetsIndex.byAssetId);
    const previousStorage = buildEmbeddedAssetStorageMap(
      Object.fromEntries([...previous].map(([assetId, indexed]) => [assetId, indexed.entry])) as Record<AssetId, KmindzSvgAssetEntryWithSizeV1>,
    );
    args.assetsIndex.byAssetId.clear();
    args.assetsIndex.knownContentHashes.clear();
    for (const sourceRecord of records) {
      const record = assetViewOf(sourceRecord, () => previousStorage);
      const embedded = collectDocumentAssetStorageMeta(record.doc);
      for (const [assetId, meta] of embedded.entries()) {
        const prev = previous.get(assetId) ?? null;
        const size = typeof meta.storage.size === "number" ? meta.storage.size : prev?.entry.size ?? 0;
        const entry: KmindzSvgAssetEntryWithSizeV1 = {
          mimeType: meta.mimeType,
          contentHash: meta.storage.contentHash,
          ext: meta.storage.ext,
          size,
        };
        args.assetsIndex.upsert(assetId, { entry });
      }
    }
  };

  /**
   * The images of a save, checked before anything changes (2026-08-12). One the save baseline's
   * package holds verified is neither read nor hashed (phase-25.9); any other is read from the
   * project's asset directory (or the memory of an old-format file) and verified. Returns the
   * verified bytes it read, by asset-directory path. A permitted anomaly is checked against the
   * baseline's own package: a derived cache is not a repair.
   */
  const preflightProjectAssets = async (
    records: Iterable<DocumentRecord>,
    rootDocId: DocumentId,
    baselinePackage: (assetId: AssetId) => Uint8Array | null,
  ): Promise<ReadonlyMap<string, Uint8Array>> => {
    const read = new Map<AssetId, { path: string; bytes: Uint8Array }>();
    // Maps opened read-only are checked through their asset views (phase-34.24).
    let storage: ReturnType<typeof buildEmbeddedAssetStorageMap> | null = null;
    await unusedAssetPolicy.validate({
      records: [...records].map((record) => assetViewOf(record, () => (storage ??= indexedAssetStorage()))),
      isVerified: isVerifiedInBaseline,
      async readExternalAsset(request) {
        if (unusedAssetPolicy.permitsAnomaly(request.assetId)) return { bytes: baselinePackage(request.assetId) };
        const path = `${resolveAssetsDir(rootDocId)}/${request.storage.contentHash}.${request.storage.ext}`;
        const bytes = await readObsidianBinaryFile(args.app, path, { suppressErrors: false }) ?? args.legacyAssets.get(path) ?? null;
        if (bytes) read.set(request.assetId, { path, bytes });
        return { bytes, path };
      },
    });
    const verified = new Map<string, Uint8Array>();
    for (const [assetId, { path, bytes }] of read) if (!unusedAssetPolicy.permitsAnomaly(assetId)) verified.set(path, bytes);
    return verified;
  };

  /**
   * A package's documents through the public docs-pack read path (phase-34.5): the manifest
   * version (1 or 2) checked against the header (4 ⇔ 2, R56) and its documents, the handwriting
   * transport of a version 1 package, the whiteboard load boundary (early whiteboard data
   * converted once, data it refuses throws), then the canonical rich text.
   */
  const decodeDocsPack = async (payload: KmindzProjectSvgPayloadV3): Promise<DocsPackRead> => {
    const observation = { stage: "documents" as const, containerVersion: 3, documentsPackVersion: null as number | null };
    try {
      const docsZipB64 = payload.docsZipB64;
      if (!docsZipB64) throw new Error("Invalid kmindz project file: missing docs pack (metadata#kmindz-docs).");
      const zipBytes = decodeBase64(docsZipB64);
      const zipMap = readZipStore(zipBytes);
      const manifestBytes = zipMap.get("manifest.json");
      if (!manifestBytes) throw new Error("Invalid kmindz docs pack: missing manifest.json.");
      const manifest = JSON.parse(decodeUtf8(manifestBytes)) as Partial<DocsPackManifest> & { handwriting?: unknown };
      observation.documentsPackVersion = typeof manifest.schemaVersion === "number" ? manifest.schemaVersion : null;
      readDocumentPackSchemaVersion(manifest.schemaVersion);
      if (typeof manifest.rootDocId !== "string" || !manifest.rootDocId.trim()) throw new Error("Invalid kmindz docs pack: missing rootDocId.");

      const header = payload.header;
      const parsed: Array<{ id: DocumentId; doc: MindMapDocumentInput }> = [];
      for (const entry of manifest.documents ?? []) {
        if (!entry || typeof entry !== "object") continue;
        const id = String((entry as { id?: unknown }).id ?? "").trim() as DocumentId;
        const path = String((entry as { path?: unknown }).path ?? "").trim();
        if (!id || !path) continue;
        const docBytes = zipMap.get(path);
        if (!docBytes) throw new Error(`Invalid kmindz docs pack: missing doc file: ${path}`);
        parsed.push({ id, doc: JSON.parse(decodeUtf8(docBytes)) as MindMapDocumentInput });
      }

      // A map whose whiteboard the load boundary refuses opens read-only (phase-34.24): its record
      // holds the sealed original, never normalized, with the header's metadata entry kept for it.
      const read = await readDocumentPackDocuments({ manifest, kmindzHeaderVersion: header.version, documents: parsed, files: zipMap, unreadableWhiteboard: "withhold" });
      const originals = new Map(read.withheld.map((entry) => [entry.docId, entry.source as MindMapDocument]));
      const records = read.documents.map(({ id, doc }): DocumentRecord => {
        const meta = header.documentsMeta[id];
        if (!meta) throw new Error(`Invalid kmindz header: missing documentsMeta for docId: ${id}`);
        const original = originals.get(id);
        if (original) rememberWithheldDocumentMeta(original, meta);
        return {
          id,
          title: meta.title,
          doc: original ?? normalizeMindMapDocumentProseMirrorContent({ doc, docId: id }).doc,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lastOpenedAt: meta.lastOpenedAt,
        };
      });

      if (!records.some((record) => record.id === header.rootDocId)) {
        throw new Error(`Invalid kmindz docs pack: missing root doc. Root: ${header.rootDocId}`);
      }
      return Object.freeze({ records: Object.freeze(records), conversions: read.conversions });
    } catch (error) { annotateDiagnosticError(error, observation); throw error; }
  };
  /** Each package object is read once (the load boundary validates every whiteboard). */
  const docsPackReads = new WeakMap<KmindzProjectSvgPayloadV3, Promise<DocsPackRead>>();
  /** A package's documents by id (a map of the caller's own) and the conversions of their reading. */
  const readDocsPack = async (payload: KmindzProjectSvgPayloadV3): Promise<{
    docs: Map<DocumentId, DocumentRecord>;
    conversions: readonly WhiteboardDocumentConversion[];
  }> => {
    let read = docsPackReads.get(payload);
    if (!read) {
      read = decodeDocsPack(payload);
      docsPackReads.set(payload, read);
    }
    const { records, conversions } = await read;
    return { docs: new Map(records.map((record) => [record.id, record])), conversions };
  };

  const syncAssetsCacheFromPack = async (rootDocId: DocumentId, payload: KmindzProjectSvgPayloadV3, policy: ProjectUnusedAssetPolicy): Promise<void> => {
    const assetsZipB64 = payload.assetsZipB64;
    if (!assetsZipB64) return;
    const zipBytes = decodeBase64(assetsZipB64);
    const zipMap = readZipStore(zipBytes, { copy: false });
    const indexBytes = zipMap.get("index.json");
    if (!indexBytes) return;
    const index = JSON.parse(decodeUtf8(indexBytes)) as Partial<AssetsPackIndexV1>;
    if (index.schemaVersion !== 1 || !index.assets || typeof index.assets !== "object") return;

    await ensureDir(args.app, resolveAssetsDir(rootDocId));
    const listed = await args.app.vault.adapter.list(resolveAssetsDir(rootDocId)).catch(() => ({ files: [] as string[] }));
    const existingNames = new Set((listed.files ?? []).map((p) => normalizeVaultPath(p).split("/").pop() || ""));

    for (const [assetId, entry] of Object.entries(index.assets) as Array<[AssetId, AssetsPackIndexV1["assets"][AssetId]]>) {
      if (!entry) continue;
      // Preserve anomalous bytes in the original package, never publish them as a healthy cache entry.
      if (policy.permitsAnomaly(assetId)) continue;
      const mimeType = String((entry as { mimeType?: unknown }).mimeType ?? "").trim();
      const contentHash = String((entry as { contentHash?: unknown }).contentHash ?? "").trim();
      const ext = String((entry as { ext?: unknown }).ext ?? "").trim();
      const size = Number((entry as { size?: unknown }).size ?? 0);
      const path = String((entry as { path?: unknown }).path ?? "").trim();
      if (!mimeType || !contentHash || !ext || !path) continue;
      if (!Number.isFinite(size) || size < 0) continue;

      const fileName = `${contentHash}.${ext}`;
      if (existingNames.has(fileName)) continue;
      const bytes = zipMap.get(path);
      if (!bytes) continue;
      const outPath = `${resolveAssetsDir(rootDocId)}/${fileName}`;
      try {
        await args.app.vault.createBinary(outPath, bytesToArrayBuffer(bytes));
        existingNames.add(fileName);
      } catch {
        // ignore
      }
    }
  };

  const inspectProjectText = async (
    text: string,
    payload: KmindzProjectSvgPayloadV3,
    resourceAccess?: "baseline" | "session",
    policy: ProjectUnusedAssetPolicy = unusedAssetPolicy,
  ): Promise<ProjectDurableDescriptor> => {
    return inspectObsidianProjectIntegrity({
      text, payload, readDocuments: async () => [...(await readDocsPack(payload)).docs.values()],
      ...(resourceAccess ? { unusedAssets: { policy, establishBaseline: resourceAccess === "baseline" } } : {}),
      onAssetsChecked: invalidAssetIds => { checkedAssetPackages.set(payload, invalidAssetIds); },
    });
  };

  /**
   * The Yjs block of a project file compared with that same file's JSON documents. Migrated
   * documents may carry metadata the old Yjs never had, so the original pair is compared.
   */
  const classifyProjectText = async (text: string, fingerprint: string): Promise<LegacyCollaborationBlockClassification> => {
    if (loadedCollaboration?.fingerprint === fingerprint) return loadedCollaboration.classification;
    const original = parseKmindzProjectV3FromSvgText(text);
    if (!original) throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
    if (!String(original.collabUpdateB64 ?? "").trim()) return Object.freeze({ kind: "absent" });
    return classifyLegacyCollaborationBlock({
      documents: [...(await readDocsPack(original)).docs.values()],
      collabUpdateB64: original.collabUpdateB64,
      expectedCollabHash: original.header.hashes?.collab,
    });
  };

  const legacyCollaborationNotice = (
    classification: LegacyCollaborationBlockClassification,
    backedUp: boolean,
  ): ProjectLegacyCollaborationNotice | null => (
    classification.kind === "inconsistent" || classification.kind === "incomplete" || classification.kind === "unreadable"
      ? Object.freeze({ kind: classification.kind, backedUp })
      : null
  );

  /** Pinned backups of one source file, deduplicated by that file's full SHA-256. */
  const findLegacyBackups = async (rootDocId: DocumentId, sourceFingerprint: string): Promise<{ original: string | null; collaboration: string | null }> => {
    const dir = resolveCheckpointsDir(rootDocId);
    const found = { original: null as string | null, collaboration: null as string | null };
    if (!await args.app.vault.adapter.exists(dir)) return found;
    const originalName = legacyMigrationBackupName("original", sourceFingerprint);
    const collaborationName = legacyMigrationBackupName("collaboration", sourceFingerprint);
    const listed = await args.app.vault.adapter.list(dir);
    for (const fullPath of listed.files ?? []) {
      const path = normalizeVaultPath(fullPath);
      const parsed = parseHistoryCheckpointFileName(path.slice(path.lastIndexOf("/") + 1));
      if (parsed.tag !== "before-migration" || !parsed.pinned) continue;
      if (!found.original && parsed.storageFormat === "package" && parsed.name === originalName
        && await sha256HexText(await args.app.vault.adapter.read(path)) === sourceFingerprint) found.original = path;
      if (!found.collaboration && parsed.storageFormat === "yjs" && parsed.name === collaborationName) found.collaboration = path;
    }
    return found;
  };

  const legacyNoticeRecordKey = (rootDocId: DocumentId) => buildObsidianKmindStorageKey(legacyCollaborationNoticeRecordKey(rootDocId));

  /**
   * Runs inside every project-file write, before the first byte changes. A legacy file (old
   * hash formats, or a Yjs block that disagrees with, cannot be matched with, or is missing
   * parts of its JSON) is first preserved: the exact original as a pinned package and, when
   * decodable, its Yjs update as a pinned `.yjs` entry that the history restore path reads. So is
   * a file whose documents the read boundary converted from early whiteboard data (phase-34.5).
   * Once the baseline is preserved it returns at once until another version becomes the baseline.
   */
  const backupOriginalBeforeRewrite = async (rootDocId: DocumentId, now: number): Promise<void> => {
    // Decided when the baseline was read or adopted; a version this session wrote never needs it.
    if (!baselineBackupCheck) return;
    /** What the save baseline needs preserved before it is rewritten; null for a current-format file. */
    const planBackup = async () => {
      const existingText = baselineText, existingPayload = baselinePayload;
      if (existingText === null || !existingPayload) throw new Error("Project baseline is not loaded.");
      const original = parseKmindzProjectV3FromSvgText(existingText);
      if (!original) throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
      const sourceFingerprint = await sha256HexText(existingText);
      const legacyHashes = await requiresLegacyProjectMigration(original);
      const classification = await classifyProjectText(existingText, sourceFingerprint);
      const collaborationBackup = legacyCollaborationBlockRequiresBackup(classification);
      const whiteboardConverted = (await readDocsPack(existingPayload)).conversions.length > 0;
      return legacyHashes || collaborationBackup || whiteboardConverted
        ? { existingText, existingPayload, original, sourceFingerprint, legacyHashes, classification, collaborationBackup }
        : null;
    };
    let plan = await planBackup();
    if (!plan) {
      baselineBackupCheck = false;
      return;
    }
    // The baseline is what the rewrite replaces, so what is preserved: the file must hold it. Another
    // writer's bytes found there become the baseline first when they are the same content (they are
    // then what is preserved), and stop the rewrite otherwise (phase-25.8).
    const disk = await readText(args.app, args.file);
    if (disk !== plan.existingText) {
      if (!await adoptChangedSource(disk)) {
        throw new ObsidianSaveConflictError("Save conflict detected: the project file changed on disk since this session loaded it.");
      }
      plan = await planBackup();
      if (!plan) {
        baselineBackupCheck = false;
        return;
      }
    }
    const { existingText, existingPayload, original, sourceFingerprint, legacyHashes, classification, collaborationBackup } = plan;
    const dir = resolveCheckpointsDir(rootDocId);
    await ensureDir(args.app, dir);
    const existing = await findLegacyBackups(rootDocId, sourceFingerprint);
    if (!existing.original) {
      await writeVerifiedHistoryFile(`${dir}/${buildHistoryCheckpointFileName({
        ts: now, tag: "before-migration", pinned: true, name: legacyMigrationBackupName("original", sourceFingerprint),
        storageFormat: "package", nonce: globalThis.crypto.randomUUID(),
      })}`, existingText);
    }
    const update = legacyCollaborationBlockRestorableUpdate(classification);
    if (update) {
      if (existing.collaboration) {
        if (await sha256Hex(await readBinaryFile(existing.collaboration)) !== await sha256Hex(update)) {
          throw new Error("Existing legacy collaboration backup does not match its source; evidence retained.");
        }
      } else {
        await writeVerifiedHistoryFile(`${dir}/${buildHistoryCheckpointFileName({
          ts: now, tag: "before-migration", pinned: true, name: legacyMigrationBackupName("collaboration", sourceFingerprint),
          storageFormat: "yjs", nonce: globalThis.crypto.randomUUID(),
        })}`, update);
      }
    }
    if (legacyHashes) {
      // Saves do not make sure of the project's directories (phase-25.9): this one writes images.
      await ensureDir(args.app, resolveAssetsDir(rootDocId));
      await prepareObsidianLegacyAssets({
        original, normalized: existingPayload, directory: resolveAssetsDir(rootDocId),
        read: path => readObsidianBinaryFile(args.app, path, { suppressErrors: false }),
        create: async (path, bytes) => { await args.app.vault.createBinary(path, bytesToArrayBuffer(bytes)); },
      });
    }
    if (collaborationBackup) {
      const notice = legacyCollaborationNotice(classification, true)!;
      // Before the file changes: once the Yjs block is rewritten away, only this record keeps the notice.
      args.deviceStorage.setItem(legacyNoticeRecordKey(rootDocId),
        encodeLegacyCollaborationNoticeRecord({ kind: notice.kind, sourceFingerprint, recordedAt: now }));
      if (loadedCollaboration?.fingerprint === sourceFingerprint) saveIntegrity.setLegacyCollaboration(notice);
    }
    // The baseline is preserved: later writes over it (and the app's waits) need nothing more.
    baselineBackupCheck = false;
  };

  /**
   * The app's save chain waits for this before writing documents this session's read boundary
   * converted from early whiteboard data (`WhiteboardConversionPort.backupOriginalBeforeFirstWrite`,
   * phase-34.5): the file's version is kept as the pinned migration backup first. In the write queue
   * like the writes it precedes; a failure fails only the save waiting for it, nothing is written.
   * A file that no longer holds the baseline is left to the write, which backs up what it replaces
   * or reports the conflict; a read-only view writes nothing, so it keeps nothing either.
   */
  const backupConvertedOriginal = (): Promise<void> => {
    const next = writeQueue.catch(() => {}).then(async () => {
      if (!args.isEditable()) return;
      await ensureLoaded();
      if (!baselineBackupCheck) return;
      const rootDocId = rootDocIdRef.value;
      if (!rootDocId) throw new Error("Project is not initialized.");
      if (await readText(args.app, args.file) !== baselineText) return;
      await backupOriginalBeforeRewrite(rootDocId, Date.now());
    });
    writeQueue = next.then(() => {}, () => {});
    return pendingWrites.track(() => next);
  };

  let maintenanceBeforeWrite: (() => Promise<void>)[] = [];
  const retainCompletedMaintenance = (task: () => Promise<void>) => {
    maintenanceBeforeWrite.push(task);
    saveIntegrity.setMaintenance({ code: "sources-retained", count: (saveIntegrity.port.getState().maintenance?.count ?? 0) + 1 });
  };
  const flushRetainedMaintenance = async () => {
    try {
      while (maintenanceBeforeWrite.length) {
        await maintenanceBeforeWrite[0]!();
        maintenanceBeforeWrite.shift();
      }
    } catch (error) { throw new ProjectSaveIOError(error, "precommit"); }
  };

  /** The source copy of an earlier version's save attempt (old safety layout). */
  const inspectSafetySource = async (sourceText: string): Promise<ProjectDurableDescriptor> => {
    const sourcePayload = await readProjectSource(sourceText);
    if (!sourcePayload) throw new Error("Invalid safety source package; evidence retained.");
    return inspectProjectText(sourceText, sourcePayload);
  };

  /**
   * A complete crash copy of another version than the file (phase-25.8): stored with the
   * conflicts as the local side, a JSON snapshot that names its images by content hash. Images
   * the project's asset directory lacks come from the copy's own package; a copy naming an image
   * it does not hold cannot be stored, and stays in place as retained evidence.
   */
  const prepareSupersededCopy = async (copyText: string, rootDocId: string): Promise<() => Promise<void>> => {
    const payload = await readProjectSource(copyText);
    if (!payload || payload.header.rootDocId !== rootDocId) throw new Error("The safety copy is not a package of this project.");
    const policy = new ProjectUnusedAssetPolicy({ retainInvalidBytes: true });
    const descriptor = await inspectProjectText(copyText, payload, "baseline", policy);
    if (descriptor.consistency === "invalid") throw new Error("The safety copy is not a consistent package.");
    const records = [...injectEmbeddedAssetStorageIntoDocs((await readDocsPack(payload)).docs, payload.header.assetsManifest).values()];
    const packed = new Set(Object.values(payload.header.assetsManifest ?? {}).map((entry) => `${entry.contentHash}.${entry.ext}`));
    for (const record of records) {
      for (const { storage } of collectDocumentAssetStorageMeta(record.doc).values()) {
        const name = `${storage.contentHash}.${storage.ext}`;
        if (!packed.has(name) && !await args.app.vault.adapter.exists(`${resolveAssetsDir(payload.header.rootDocId)}/${name}`)) {
          throw new Error("The safety copy names an image it does not hold.");
        }
      }
    }
    return async () => {
      const projectId = payload.header.rootDocId;
      await ensureProjectStorageDirs(projectId);
      await syncAssetsCacheFromPack(projectId, payload, policy);
      await writeSnapshotAssets(projectId, records);
      const fingerprint = await projectRecordsContentFingerprint(records);
      if (await conflictIndexFor(projectId).find(["local"], fingerprint)) return;
      const now = Date.now();
      await writeConflictGroupFile(projectId, "local", now, encodeProjectDocsSnapshotV1({ rootDocId: projectId, capturedAt: now, records }), fingerprint);
    };
  };

  type PreparedDiskVersion = Readonly<{
    text: string;
    payload: KmindzProjectSvgPayloadV3;
    descriptor: ProjectDurableDescriptor;
    policy: ProjectUnusedAssetPolicy;
    records: ReadonlyMap<DocumentId, DocumentRecord>;
    /** False when the safety directory was not inspected: the session keeps what it knew. */
    maintenanceChecked: boolean;
    maintenance: ProjectSafetyMaintenanceWarning | null;
    deferred: readonly (() => Promise<void>)[];
    /** Superseded save attempts, settled before the next write; not retained maintenance. */
    settlements: readonly (() => Promise<void>)[];
    legacyPending: boolean;
    legacyAssets: ReadonlyMap<string, Uint8Array>;
    classification: LegacyCollaborationBlockClassification;
    notice: ProjectLegacyCollaborationNotice | null;
    /** Its documents the read boundary converted from early whiteboard data. */
    whiteboardConversions: readonly WhiteboardDocumentConversion[];
  }>;

  /**
   * Every read, verification and derived-cache write of a disk version, without touching session
   * state. `skipMaintenance`: a read-only view following this device's editing view (phase-25.9)
   * leaves the safety directory to that view; taking over editing inspects it.
   */
  const prepareDiskVersion = async (
    text: string,
    payload: KmindzProjectSvgPayloadV3,
    options: { inspectOnly: boolean; skipMaintenance?: boolean | undefined },
  ): Promise<PreparedDiskVersion> => {
    const policy = new ProjectUnusedAssetPolicy({ retainInvalidBytes: true });
    const descriptor = await observeDiagnosticOperation("integrity", () => inspectProjectText(text, payload, "baseline", policy), { containerVersion: 3 });
    const deferred: (() => Promise<void>)[] = [];
    const settlements: (() => Promise<void>)[] = [];
    const maintenance = options.skipMaintenance ? null : await cleanupObsidianCompletedTransactions({
      app: args.app, file: args.file, currentText: text, descriptor, inspectOnly: options.inspectOnly,
      deferBeforeWrite: task => { deferred.push(task); },
      settleBeforeWrite: task => { settlements.push(task); },
      inspectSource: inspectSafetySource,
      prepareSupersededCopy,
    });
    const original = parseKmindzProjectV3FromSvgText(text)!;
    const read = await readDocsPack(payload);
    const records = await withProjectManifestBootstrap(
      payload.header.rootDocId,
      injectEmbeddedAssetStorageIntoDocs(read.docs, payload.header.assetsManifest),
    );
    const pending = await requiresLegacyProjectMigration(original);
    const legacyAssets = new Map<string, Uint8Array>();
    if (pending) {
      const assets = await prepareObsidianLegacyAssets({
        original, normalized: payload, directory: resolveAssetsDir(payload.header.rootDocId),
        read: path => readObsidianBinaryFile(args.app, path, { suppressErrors: false }),
      });
      for (const [path, bytes] of assets) legacyAssets.set(path, bytes);
    } else await syncAssetsCacheFromPack(payload.header.rootDocId, payload, policy);
    const classification = await classifyProjectText(text, descriptor.fullFileFingerprint);
    const backups = legacyCollaborationBlockRequiresBackup(classification)
      ? await findLegacyBackups(payload.header.rootDocId, descriptor.fullFileFingerprint)
      : null;
    const backedUp = Boolean(backups?.original && (!legacyCollaborationBlockRestorableUpdate(classification) || backups.collaboration));
    // The file's own Yjs block decides; a file this device already rewrote keeps this device's record.
    const notice = await resolveLegacyCollaborationNoticeOnOpen({
      fileNotice: legacyCollaborationNotice(classification, backedUp),
      readRecord: async () => args.deviceStorage.getItem(legacyNoticeRecordKey(payload.header.rootDocId)),
      hasRecordedOriginal: async (sourceFingerprint) => Boolean((await findLegacyBackups(payload.header.rootDocId, sourceFingerprint)).original),
    });
    return Object.freeze({
      text, payload, descriptor, policy, records, maintenanceChecked: !options.skipMaintenance, maintenance, deferred, settlements,
      legacyPending: pending, legacyAssets, classification, notice, whiteboardConversions: read.conversions,
    });
  };

  /** Synchronous: the verified version becomes the session baseline in one step. */
  const commitDiskVersion = (prepared: PreparedDiskVersion): void => {
    if (prepared.maintenanceChecked) {
      maintenanceBeforeWrite = [...prepared.deferred, ...prepared.settlements];
      saveIntegrity.setMaintenance(prepared.maintenance ?? (prepared.deferred.length ? { code: "sources-retained", count: prepared.deferred.length } : null));
    }
    unusedAssetPolicy = prepared.policy;
    cachedById.clear();
    for (const [id, record] of prepared.records) {
      cachedById.set(id, record);
      persistedDocuments.add(record.doc);
    }
    rootDocIdRef.value = prepared.payload.header.rootDocId;
    if (prepared.payload.header.assetsManifest) args.assetsIndex.loadFromManifest(prepared.payload.header.assetsManifest);
    rebuildAssetIndexFromRecords(cachedById.values());
    args.legacyAssets.clear();
    for (const [path, bytes] of prepared.legacyAssets) args.legacyAssets.set(path, bytes);
    legacyPending = prepared.legacyPending;
    sessionWhiteboardConversions = prepared.whiteboardConversions;
    setSaveBaseline(prepared.text, prepared.payload, prepared.descriptor,
      prepared.legacyPending || legacyCollaborationBlockRequiresBackup(prepared.classification)
        || prepared.whiteboardConversions.length > 0);
    loadedCollaboration = { fingerprint: prepared.descriptor.fullFileFingerprint, classification: prepared.classification };
    saveIntegrity.setLegacyCollaboration(prepared.notice);
    saveIntegrity.reset();
    loaded = true;
  };

  /**
   * Same revision, different bytes: an older version refreshing the file's preview (this version
   * no longer writes one), or a save that changed only timestamps. The verified bytes become the new byte baseline only
   * when the content identity is unchanged; callers refuse everything else, so a content
   * change that kept the old revision stays blocked.
   */
  const acceptSameContentBytes = async (
    text: string,
    payload: KmindzProjectSvgPayloadV3,
    verified?: ProjectDurableDescriptor,
  ): Promise<boolean> => {
    if (baselineContentIdentity === null || projectContentIdentity(payload) !== baselineContentIdentity) return false;
    const descriptor = verified ?? await inspectProjectText(text, payload, "session");
    setSaveBaseline(text, payload, descriptor);
    return true;
  };

  let openingText = args.openingText ?? null;
  const ensureLoaded = async (): Promise<void> => {
    if (loaded) return;
    const opening = openingText;
    openingText = null;
    const text = opening ?? await observeDiagnosticOperation("read", () => readText(args.app, args.file));
    const payload = text ? await readProjectSource(text) : null;
    if (payload) {
      commitDiskVersion(await prepareDiskVersion(text, payload, { inspectOnly: false }));
      return;
    }
    throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
  };

  /** Reads the current disk bytes under the write queue and checks they belong to this project. */
  const readDiskProjectText = async (): Promise<{ text: string; payload: KmindzProjectSvgPayloadV3; fingerprint: string }> =>
    parseDiskProjectText(await observeDiagnosticOperation("read", () => readText(args.app, args.file)));
  const parseDiskProjectText = async (text: string): Promise<{ text: string; payload: KmindzProjectSvgPayloadV3; fingerprint: string }> => {
    const payload = text ? await readProjectSource(text) : null;
    if (!payload) {
      if (text.trim().length > 0) throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
      throw new Error("Existing project file is empty; it cannot replace the open project.");
    }
    if (payload.header.rootDocId !== rootDocIdRef.value) {
      throw projectProtectionError("identity-mismatch", "The file on disk belongs to a different project.");
    }
    return { text, payload, fingerprint: await sha256HexText(text) };
  };

  /**
   * A thumbnail next to a history entry (`.preview.svg`). It only serves the history panel: a
   * missing or failed one never weakens the entry, never stops a save and is not reported.
   */
  const writeHistoryThumbnail = async (entryPath: string, svg: string): Promise<void> => {
    try {
      const thumbnailPath = resolveHistoryThumbnailPath(entryPath);
      if (!thumbnailPath || !await args.app.vault.adapter.exists(entryPath)) return;
      await args.app.vault.adapter.write(thumbnailPath, svg);
      args.preview.notifyHistoryThumbnail();
    } catch (error) {
      console.error("[kmind-zen] history thumbnail write failed:", error);
    }
  };

  /**
   * Obsidian's process found other bytes than the save baseline (phase-25.8: this is decided
   * inside the write, not by reading the file before it). The same revision with the same content
   * (another version's preview, or a save that changed only timestamps) becomes the baseline and
   * is replaced; other content at the same revision is refused; another revision is an ordinary
   * conflict, once the external version passed the collapse check.
   */
  const adoptChangedSource = async (currentText: string): Promise<boolean> => {
    const payload = currentText ? await readProjectSource(currentText) : null;
    if (!payload) throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
    if (payload.header.rev === expectedProjectRev.value) {
      if (await acceptSameContentBytes(currentText, payload)) return true;
      saveIntegrity.quarantine();
      throw new Error("Save conflict detected: project bytes changed without a new revision.");
    }
    const descriptor = await inspectProjectText(currentText, payload);
    if (durableDescriptor) saveIntegrity.assertExternalTransition(durableDescriptor, descriptor);
    return false;
  };

  /** An automatic snapshot's thumbnail: exported in the background after the save that wrote it. */
  const scheduleSnapshotThumbnail = (snapshotPath: string): void => {
    if (closing) return;
    void (async () => {
      await waitForRevisionPreviewBackgroundStart();
      if (closing) return;
      const svg = await args.preview.exportHistorySvg();
      if (!svg || closing) return;
      await writeHistoryThumbnail(snapshotPath, svg);
    })().catch((error) => {
      console.error("[kmind-zen] history snapshot thumbnail failed:", error);
    });
  };

  /**
   * The check of a candidate that keeps the baseline's image package (phase-25.9): its text parses
   * back to exactly the components just built (whose hashes the header carries); statistics and
   * semantic fingerprints come from the records it was built from, the full file is hashed once.
   * The kept package was verified with the baseline, so its images are not checked again; every
   * invalid entry it carries must still be a permitted anomaly, as for any verified package.
   */
  const describeCandidateKeepingImages = async (candidate: {
    text: string;
    payload: KmindzProjectSvgPayloadV3;
    header: KmindzProjectSvgHeaderV3;
    docsZipB64: string;
    assetsZipB64: string | null;
    records: readonly DocumentRecord[];
  }): Promise<ProjectDurableDescriptor> => {
    if (candidate.payload.docsZipB64 !== candidate.docsZipB64 || (candidate.payload.assetsZipB64 ?? null) !== candidate.assetsZipB64
      || stableProjectJson(candidate.payload.header) !== stableProjectJson(candidate.header)) {
      throw new Error("Built project package failed parser round-trip.");
    }
    assertDocumentAssetsMatchManifest(candidate.records, candidate.header.assetsManifest ?? {});
    for (const id of baselineInvalidAssets) {
      if (!unusedAssetPolicy.permitsAnomaly(id)) throw projectProtectionError("assets-invalid", "Unowned missing resource cannot be exempted.");
    }
    const descriptor = await inspectProjectDurableSnapshot({
      rootDocId: candidate.header.rootDocId,
      documents: candidate.records,
      assetManifest: candidate.header.assetsManifest ?? null,
      fullFileText: candidate.text,
    });
    if (descriptor.diagnostics.length > 0) {
      throw projectProtectionError(descriptor.diagnostics[0]!, `[${descriptor.diagnostics[0]}] Project integrity verification failed.`);
    }
    checkedAssetPackages.set(candidate.payload, baselineInvalidAssets);
    return descriptor;
  };

  /**
   * The single project-file writer: JSON documents, resources and header only. `records`
   * replaces the whole record set (history restore); the cache follows only after the write.
   * `checked`: what the caller (`put`) already checked for these records before changing the
   * session cache, the verified images it read and the documents it asserted.
   */
  const buildAndWriteProjectFile = async (options?: {
    records?: ReadonlyMap<DocumentId, DocumentRecord> | undefined;
    checked?: { images: ReadonlyMap<string, Uint8Array>; documents: ReadonlySet<object> } | undefined;
  }): Promise<{ rev: string; updatedAt: number }> => {
    saveIntegrity.assertWritable();
    assertEditable();
    const now = Date.now();
    const rootDocId = rootDocIdRef.value;
    if (!rootDocId) throw new Error("Project is not initialized.");

    // The session's baseline is the version this write replaces; whether the file still holds it
    // is decided inside Obsidian's write queue (`writeObsidianProjectSafely`).
    const existingText = baselineText;
    const existingPayload = baselinePayload;
    const sourceDescriptor = durableDescriptor;
    if (existingText === null || !existingPayload || !sourceDescriptor) throw new Error("Project baseline is not loaded.");
    const currentRev = existingPayload.header.rev;

    const docs = Object.fromEntries((options?.records ?? cachedById).entries()) as Record<DocumentId, DocumentRecord>;
    // Only documents this session changed can carry what may not be persisted (phase-25.9).
    for (const record of Object.values(docs)) {
      if (persistedDocuments.has(record.doc) || options?.checked?.documents.has(record.doc)) continue;
      // A map opened read-only is written as its sealed original, never normalized (phase-34.24);
      // the persistence guard lets that very object through.
      if (!isWithheldWhiteboardSource(record.doc)) assertMindMapDocumentProseMirrorCanonical({ doc: record.doc, docId: record.id });
      assertWhiteboardPersistenceContract(record.doc);
    }
    const baselinePackage = openBaselineAssetPackage();
    const verifiedImages = options?.checked?.images ?? await preflightProjectAssets(Object.values(docs), rootDocId, baselinePackage);
    /** An image of a rebuilt package: verified bytes this save read, or the baseline package's verified ones. */
    const verifiedImageBytes = (assetId: AssetId | null, entry: KmindzSvgAssetEntryWithSizeV1): Uint8Array => {
      const read = verifiedImages.get(`${resolveAssetsDir(rootDocId)}/${entry.contentHash.toLowerCase()}.${entry.ext.toLowerCase()}`);
      if (read) return read;
      const kept = assetId ? existingPayload.header.assetsManifest?.[assetId] : undefined;
      if (assetId && kept && !baselineInvalidAssets.has(assetId) && kept.contentHash === entry.contentHash
        && kept.ext === entry.ext && kept.size === entry.size) {
        const bytes = baselinePackage(assetId);
        if (bytes) return bytes;
      }
      throw projectProtectionError("assets-invalid", `Image ${assetId ?? entry.contentHash} was not verified by this save.`);
    };

    // Version 2 once any document has a whiteboard (with header 4, R56): readers that only know
    // version 1 stop before they could write the file back (phase-34.1 design §3.1).
    const writtenDocs = Object.values(docs).map((record) => record.doc);
    const docsManifest: DocsPackManifest = {
      schemaVersion: resolveDocumentPackSchemaVersion(writtenDocs),
      rootDocId,
      documents: Object.values(docs)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((record) => ({ id: record.id, title: record.title, path: `docs/${record.id}.json` })),
    };
    const docsZipBytes = createZipStore([
      { path: "manifest.json", bytes: encodeUtf8(JSON.stringify(docsManifest)) },
      ...Object.values(docs)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((record) => ({ path: `docs/${record.id}.json`, bytes: encodeUtf8(JSON.stringify(record.doc)) })),
    ]);
    const docsZipB64 = encodeBase64(docsZipBytes);
    const docsHash = await sha256Hex(docsZipBytes);

    const referencedAssetIds = new Set<AssetId>();
    for (const record of Object.values(docs)) {
      for (const assetId of Object.keys(record.doc.assets ?? {}) as AssetId[]) referencedAssetIds.add(assetId);
    }
    const embeddedAssetMetaById = new Map<AssetId, { mimeType: string; storage: NonNullable<ReturnType<typeof normalizeMindMapExternalAssetStorage>> }>();
    for (const record of Object.values(docs)) {
      const embedded = collectDocumentAssetStorageMeta(record.doc);
      for (const [assetId, meta] of embedded.entries()) {
        if (!embeddedAssetMetaById.has(assetId)) embeddedAssetMetaById.set(assetId, meta);
      }
    }
    const assetsManifest: Record<AssetId, KmindzSvgAssetEntryWithSizeV1> = unusedAssetPolicy.count ? { ...existingPayload.header.assetsManifest } : {};
    for (const assetId of referencedAssetIds) {
      const indexed = args.assetsIndex.get(assetId);
      if (indexed) {
        assetsManifest[assetId] = indexed.entry;
        continue;
      }
      const embedded = embeddedAssetMetaById.get(assetId);
      if (!embedded) continue;
      const entry: KmindzSvgAssetEntryWithSizeV1 = {
        mimeType: embedded.mimeType,
        contentHash: embedded.storage.contentHash,
        ext: embedded.storage.ext,
        size: embedded.storage.size ?? 0,
      };
      assetsManifest[assetId] = entry;
    }

    const existingAssetsManifest = existingPayload.header.assetsManifest;
    const assetsManifestChanged = serializeAssetsManifest(existingAssetsManifest) !== serializeAssetsManifest(assetsManifest);

    let assetsZipB64: string | null = null;
    let assetsHash: string | null = null;
    if (!assetsManifestChanged && existingPayload.assetsZipB64) {
      assetsZipB64 = existingPayload.assetsZipB64;
      assetsHash = existingPayload.header.hashes?.assets ?? null;
    } else if (unusedAssetPolicy.count > 0) {
      // Existing entries stay verbatim; only added images are read, from this save's verified bytes.
      const bytes = await buildPreservedProjectAssetPack({
        existing: existingPayload, manifest: assetsManifest,
        permitsMissing: id => unusedAssetPolicy.permitsMissing(id),
        read: async entry => verifiedImageBytes(null, entry),
      });
      assetsZipB64 = encodeBase64(bytes);
      assetsHash = await sha256Hex(bytes);
    } else if (Object.keys(assetsManifest).length > 0 || existingPayload.assetsZipB64) {
      const index: AssetsPackIndexV1 = {
        schemaVersion: 1,
        assets: Object.fromEntries(
          Object.keys(assetsManifest)
            .sort((a, b) => a.localeCompare(b))
            .map((assetId) => {
              const entry = assetsManifest[assetId as AssetId]!;
              const path = `assets/${entry.contentHash}.${entry.ext}`;
              return [assetId, { ...entry, path }] as const;
            }),
        ),
      };

      const files: Array<{ path: string; bytes: Uint8Array }> = [{ path: "index.json", bytes: encodeUtf8(JSON.stringify(index)) }];
      const uniqueByPath = new Map<string, Uint8Array>();
      // From verified bytes only: the baseline package's, or what this save read (phase-25.9).
      for (const [assetId, entry] of Object.entries(index.assets) as Array<[AssetId, AssetsPackIndexV1["assets"][AssetId]]>) {
        if (!entry?.path) continue;
        if (uniqueByPath.has(entry.path)) continue;
        uniqueByPath.set(entry.path, verifiedImageBytes(assetId, entry));
      }
      for (const [path, bytes] of Array.from(uniqueByPath.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        files.push({ path, bytes });
      }
      const assetsZipBytes = await createProjectAssetPackWithExtensions({ files, previousZipB64: existingPayload.assetsZipB64 });
      assetsZipB64 = encodeBase64(assetsZipBytes);
      assetsHash = await sha256Hex(assetsZipBytes);
    }

    // A map opened read-only writes back the entry it was read with (phase-34.24).
    const documentsMeta = Object.fromEntries(
      Object.values(docs).map((record) => [record.id, projectDocumentMetaOf(record)]),
    ) as KmindzProjectSvgHeaderV3["documentsMeta"];

    // The revision keeps its historical shape; JSON-only files have neither Yjs nor generation.
    const contentRev = await sha256HexFromString(
      JSON.stringify({ rootDocId, collab: null, docs: docsHash, assets: assetsHash, generation: null }),
    );

    const rootRecord = docs[rootDocId];
    const header: KmindzProjectSvgHeaderV3 = {
      format: "kmindz-project-svg",
      version: resolveKmindzProjectHeaderVersion(writtenDocs),
      mapKey: rootDocId,
      rootDocId,
      createdAt: rootRecord?.createdAt ?? now,
      updatedAt: now,
      lastOpenedAt: Math.max(...Object.values(docs).map((r) => r.lastOpenedAt ?? 0), now),
      rev: contentRev,
      documentsMeta,
      assetsManifest: Object.keys(assetsManifest).length > 0 ? assetsManifest : undefined,
      hashes: { docs: docsHash, assets: assetsHash ?? undefined },
      host: { kind: "obsidian" },
    };

    // The preview slot holds the fixed placeholder: a save renders no preview (phase-25.7).
    const nextText = encodeKmindzProjectV3IntoSvgText({
      previewSvg: OBSIDIAN_MAP_PLACEHOLDER_SVG,
      header,
      docsZipB64,
      assetsZipB64,
    });

    const candidatePayload = parseKmindzProjectV3FromSvgText(nextText);
    if (!candidatePayload) throw new Error("Built project package failed parser round-trip.");
    // A candidate that keeps the baseline's image package as it is does not check it again; a
    // rebuilt package is checked in full, as any version is.
    const keepsImagePackage = !assetsManifestChanged && assetsZipB64 === (existingPayload.assetsZipB64 ?? null);
    const candidateDescriptor = keepsImagePackage
      ? await describeCandidateKeepingImages({ text: nextText, payload: candidatePayload, header, docsZipB64, assetsZipB64, records: Object.values(docs) })
      : await inspectProjectText(nextText, candidatePayload, "session");
    await saveIntegrity.commit({
      before: sourceDescriptor,
      after: candidateDescriptor,
      revision: currentRev,
      changedDocIds: async () => {
        const before = (await readDocsPack(existingPayload)).docs;
        const after = (await readDocsPack(candidatePayload)).docs;
        return [...new Set([...before.keys(), ...after.keys()])].filter(id => (
          serializeProjectDocumentSemantics(before.get(id)?.doc) !== serializeProjectDocumentSemantics(after.get(id)?.doc)
        ));
      },
      write: async () => {
        await backupOriginalBeforeRewrite(rootDocId, now);
        await flushRetainedMaintenance();
        recordObsidianEditorWriteIntent(args.file, candidateDescriptor.fullFileFingerprint);
        // The migration backup may have adopted another writer's same-content bytes as the baseline.
        const replacing = baselineText;
        if (replacing === null) throw new Error("Project baseline is not loaded.");
        try {
          await writeObsidianProjectSafely({
            app: args.app,
            file: args.file,
            baselineText: replacing,
            nextText,
            candidateFingerprint: candidateDescriptor.fullFileFingerprint,
            ensureSafetyDirectory,
            adoptChangedSource,
            onRetainedCompletedCopy: retainCompletedMaintenance,
          });
        } catch (error) {
          safetyDirectory = null;
          throw error;
        }
      },
    });
    legacyPending = false;
    args.legacyAssets.clear();
    if (options?.records) {
      cachedById.clear();
      for (const [id, record] of options.records) cachedById.set(id, record);
    }
    rebuildAssetIndexFromRecords(Object.values(docs));
    for (const record of Object.values(docs)) persistedDocuments.add(record.doc);
    setSaveBaseline(nextText, candidatePayload, candidateDescriptor, false);
    recordObsidianEditorWrite(args.file, candidateDescriptor.fullFileFingerprint);

    try {
      const historyPath = await maybeWriteAutoHistorySnapshot({ rootDocId, records: Object.values(docs), now });
      if (historyPath) scheduleSnapshotThumbnail(historyPath);
    } catch (error) {
      // The next snapshot makes sure of the project's directories again (they may have gone).
      autoHistoryCache.loaded = false;
      console.error("[kmind-zen] auto history snapshot write failed:", error);
    }
    return { rev: header.rev, updatedAt: header.updatedAt };
  };

  /**
   * A map opened read-only (phase-34.24) is never changed through this store: its cached record holds
   * the sealed original, which only a whole-project write carries back as it is. The app's store
   * wrapper refuses first; this is the host's own gate.
   */
  const rejectWithheldWrite = (docId: DocumentId): void => {
    const cached = cachedById.get(docId);
    if (cached && isWithheldWhiteboardSource(cached.doc)) throw withheldDocumentWriteError(docId, cached.title);
  };

  const store = {
    beginCloseInternal() {
      closing = true;
    },
    hasPendingWritesInternal: pendingWrites.hasPending,
    trackWriteInternal: pendingWrites.track,
    async whenWritesIdleInternal() {
      for (;;) {
        const pending = writeQueue;
        await pending;
        await pendingWrites.whenIdle();
        if (pending === writeQueue && !pendingWrites.hasPending()) return;
      }
    },
    projectSaveIntegrityInternal: {
      ...saveIntegrity.port,
      getState: () => ({ ...saveIntegrity.port.getState(), unusedAssetIssueCount: unusedAssetPolicy.count }),
      /** Device-local only (no project write), so a read-only pane may dismiss as well. */
      async dismissLegacyCollaborationNotice() {
        const rootDocId = rootDocIdRef.value;
        if (!rootDocId) throw new Error("Project is not initialized.");
        args.deviceStorage.removeItem(legacyNoticeRecordKey(rootDocId));
        saveIntegrity.setLegacyCollaboration(null);
      },
    },
    whiteboardConversionInternal: {
      getDocumentConversions: () => sessionWhiteboardConversions,
      backupOriginalBeforeFirstWrite: backupConvertedOriginal,
    } satisfies WhiteboardConversionPort,
    async list() {
      await ensureLoaded();
      return Array.from(cachedById.values()).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    },
    async get(id: DocumentId) {
      await ensureLoaded();
      return cachedById.get(id) ?? null;
    },
    async put(record: DocumentRecord) {
      await enqueueWrite(async () => {
        saveIntegrity.assertWritable();
        await ensureLoaded();
        rejectWithheldWrite(record.id);
        assertMindMapDocumentProseMirrorCanonical({ doc: record.doc, docId: record.id });
        assertWhiteboardPersistenceContract(record.doc);
        const previous = cachedById.get(record.id);
        if (legacyPending && previous && previous.title === record.title
          && serializeProjectDocumentSemantics(previous.doc) === serializeProjectDocumentSemantics(record.doc)) return;
        const candidateRootDocId = rootDocIdRef.value ?? record.id;
        const candidateRecords = new Map(cachedById);
        candidateRecords.set(record.id, record);
        // The save's only image check, before the root, the cache or the file changes (2026-08-12).
        const images = await preflightProjectAssets(candidateRecords.values(), candidateRootDocId, openBaselineAssetPackage());
        if (!rootDocIdRef.value) rootDocIdRef.value = candidateRootDocId;
        cachedById.set(record.id, record);
        await buildAndWriteProjectFile({ checked: { images, documents: new Set([record.doc]) } });
      });
    },
    async delete(id: DocumentId) {
      await enqueueWrite(async () => {
        saveIntegrity.assertWritable();
        assertEditable();
        await ensureLoaded();
        const rootDocId = rootDocIdRef.value;
        if (rootDocId && id === rootDocId) {
          // Deleting the project deletes every map in it: refused while one is read-only (phase-34.24).
          for (const docId of cachedById.keys()) rejectWithheldWrite(docId);
          const sourceText = await readText(args.app, args.file);
          const payload = await readProjectSource(sourceText);
          if (!payload || payload.header.rootDocId !== rootDocId) throw new Error("Deletion source project identity is invalid.");
          const descriptor = await inspectProjectText(sourceText, payload);
          if (descriptor.fullFileFingerprint !== expectedProjectFingerprint && !await acceptSameContentBytes(sourceText, payload, descriptor)) {
            throw new Error("Project changed before deletion; reload before deleting.");
          }
          await saveIntegrity.withOperation({
            projectId: rootDocId, kind: "root-delete", targetDocIds: [...cachedById.keys()],
          }, () => trashObsidianProjectSafely({
            app: args.app, file: args.file, sourceText,
            createCheckpoint: () => store.writeProjectCheckpointPackageInternal({
              tag: "before-destructive-save", pinned: true, name: null,
            }),
          }));
          cachedById.clear();
          expectedProjectRev.value = null;
          expectedProjectFingerprint = null;
          durableDescriptor = null;
          baselineText = null;
          baselinePayload = null;
          baselineContentIdentity = null;
          loadedCollaboration = null;
          sessionWhiteboardConversions = [];
          saveIntegrity.setLegacyCollaboration(null);
          rootDocIdRef.value = null;
          autoHistoryCache.loaded = false;
          autoHistoryCache.latestTs = 0;
          baselineToken += 1;
          loaded = false;
          return;
        }
        if (!rootDocId) throw new Error("Project is not initialized.");
        rejectWithheldWrite(id);
        await saveIntegrity.withOperation({
          projectId: rootDocId, kind: "submap-delete", targetDocIds: [id],
        }, async () => {
          const next = new Map(cachedById);
          next.delete(id);
          await buildAndWriteProjectFile({ records: next });
        });
      });
    },
    writeProjectCheckpointPackageInternal: (args2: { tag: ProjectCheckpointTag; pinned: boolean; name: string | null }) => pendingWrites.track(async () => {
      assertEditable();
      await ensureLoaded();
      const rootDocId = rootDocIdRef.value;
      if (!rootDocId) throw new Error("Project is not initialized.");
      const text = await observeDiagnosticOperation("read", () => readText(args.app, args.file));
      if (!text.trim()) throw new Error("Project file is empty; cannot create package checkpoint.");
      const payload = await readProjectSource(text);
      if (!payload || payload.header.rootDocId !== rootDocId) throw new Error("Checkpoint source project identity is invalid.");
      await inspectProjectText(text, payload, await sha256HexText(text) === expectedProjectFingerprint ? "session" : undefined);
      const checkpointsDir = resolveCheckpointsDir(rootDocId);
      await ensureDir(args.app, checkpointsDir);
      const fileName = buildHistoryCheckpointFileName({
        ts: Date.now(),
        tag: args2.tag,
        pinned: args2.pinned,
        name: args2.name,
        storageFormat: "package",
        nonce: globalThis.crypto.randomUUID(),
      });
      const path = `${checkpointsDir}/${fileName}`;
      // Hidden plugin files are not indexed TFiles. Vault.create can return null
      // here even after writing; use the adapter with a unique attempt filename.
      if (await args.app.vault.adapter.exists(path)) throw new Error("Project checkpoint path already exists.");
      await args.app.vault.adapter.write(path, text);
      if (await args.app.vault.adapter.read(path) !== text) {
        throw new Error("Project checkpoint failed exact read-back verification.");
      }
      // Exported now, while the view still shows what the checkpoint holds: a restore or an import
      // replaces it right after. A deletion checkpoint has no view to export (phase-25.7).
      if (args2.tag !== "before-destructive-save") {
        const svg = await args.preview.exportHistorySvg();
        if (svg) await writeHistoryThumbnail(path, svg);
      }
      return { path };
    }),
    /**
     * Before a waiting view starts editing. An earlier editing view of this file may have left a
     * save transaction: an unfinished or conflicting one quarantines the project with its sources
     * kept, as opening does; completed ones are retired before this view's first write, as after
     * any adoption. Never throws: a view that cannot inspect them does not start editing.
     */
    prepareTakeoverInternal: () => enqueueWrite(async () => {
      try {
        await ensureLoaded();
        if (saveIntegrity.port.getState().mode === "quarantine") return;
        const disk = await readDiskProjectText();
        const descriptor = await inspectProjectText(disk.text, disk.payload);
        const maintenance = await cleanupObsidianCompletedTransactions({
          app: args.app, file: args.file, currentText: disk.text, descriptor, inspectOnly: true,
          deferBeforeWrite: task => { maintenanceBeforeWrite.push(task); },
          settleBeforeWrite: task => { maintenanceBeforeWrite.push(task); },
          inspectSource: inspectSafetySource,
          prepareSupersededCopy,
        });
        if (maintenance) saveIntegrity.setMaintenance(maintenance);
      } catch (error) {
        console.error("[kmind-zen] save transactions could not be settled before editing", error);
        saveIntegrity.quarantine("project-quarantined");
      }
    }, false),
    readDiskProjectVersionInternal: (args2?: { force?: boolean | undefined }): Promise<ProjectDiskVersion> => enqueueWrite(async () => {
      saveIntegrity.assertWritable();
      await ensureLoaded();
      const text = await observeDiagnosticOperation("read", () => readText(args.app, args.file));
      // This session's own write, or the version it adopted: the same bytes, nothing to parse or hash.
      if (text === baselineText && !args2?.force) return Object.freeze({ kind: "unchanged" as const });
      const disk = await parseDiskProjectText(text);
      if (disk.payload.header.rev === expectedProjectRev.value) {
        if (disk.fingerprint !== expectedProjectFingerprint && !await acceptSameContentBytes(disk.text, disk.payload)) {
          throw projectProtectionError("project-baseline-changed", "Save conflict detected: same-revision external project bytes changed.");
        }
        if (!args2?.force) return Object.freeze({ kind: "unchanged" as const });
      }
      // The editing view of this file already verified its own writes and keeps its safety
      // directory; anything else is external.
      const editorWrite = isObsidianEditorWrite(args.file, disk.fingerprint);
      const prepared = await prepareDiskVersion(disk.text, disk.payload, { inspectOnly: true, skipMaintenance: editorWrite });
      if (!durableDescriptor) throw new Error("External reload requires a verified project baseline.");
      if (!editorWrite) saveIntegrity.assertExternalTransition(durableDescriptor, prepared.descriptor);
      const token = baselineToken;
      return Object.freeze({
        kind: "changed" as const,
        rootDocId: prepared.payload.header.rootDocId,
        records: Object.freeze([...prepared.records.values()]),
        writtenByThisDevice: editorWrite,
        adopt: () => {
          if (token !== baselineToken) {
            throw projectProtectionError("session-changed", "The project baseline changed before the disk version was adopted; reload again.");
          }
          commitDiskVersion(prepared);
        },
      });
    }, false),
    prepareOverwriteDiskVersionInternal: () => enqueueWrite(async () => {
      saveIntegrity.assertWritable();
      await ensureLoaded();
      const disk = await readDiskProjectText();
      const descriptor = await inspectProjectText(disk.text, disk.payload);
      // Keep the session records; the next ordinary save replaces exactly this verified version.
      setSaveBaseline(disk.text, disk.payload, descriptor);
    }, false),
    replaceProjectRecordsInternal: (args2: Parameters<ProjectRecordsPort["replaceProjectRecords"]>[0]) => enqueueWrite(async () => {
      saveIntegrity.assertWritable();
      await ensureLoaded();
      const rootDocId = rootDocIdRef.value;
      if (!rootDocId || args2.rootDocId !== rootDocId) {
        throw projectProtectionError("identity-mismatch", "Replacement records belong to a different project.");
      }
      const next = new Map(args2.records.map((record) => [record.id, record] as const));
      await saveIntegrity.withOperation({
        projectId: rootDocId,
        kind: args2.operation === "history-restore" ? "history-restore" : "replace-import",
        targetDocIds: [...new Set([...cachedById.keys(), ...next.keys()])],
      }, () => buildAndWriteProjectFile({ records: next }));
    }),
    exportCurrentProjectTextInternal: async () => {
      await ensureLoaded();
      const existingText = await readText(args.app, args.file);
      const existingPayload = existingText ? await readProjectSource(existingText) : null;
      if (existingText.trim().length > 0 && !existingPayload) {
        throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
      }
      await enqueueWrite(async () => {}, false);
      return {
        text: existingText,
        payload: {
          rootDocId: rootDocIdRef.value ?? ("" as DocumentId),
          revision: existingPayload?.header.rev ?? "",
        },
      };
    },
    /**
     * After an operation that wrote a safety checkpoint (restore, replace import) succeeded, that
     * kind keeps its newest ten (`planProjectHistoryRetention`), the new checkpoint included.
     */
    completePackageCheckpointInternal: (args2: { checkpoint: { path: string }; tag: ProjectCheckpointTag; outcome: "success" | "failure" }) => pendingWrites.track(async () => {
      if (args2.outcome !== "success" || args2.tag === "manual") return;
      const rootDocId = rootDocIdRef.value;
      if (!rootDocId) throw new Error("Project is not initialized.");
      await applyObsidianHistoryRetention(args.app, rootDocId, { mode: "safety", safetyTag: args2.tag, protectedPaths: [args2.checkpoint.path] });
    }),
    /**
     * Both sides of a conflict, before any choice is offered: the disk bytes exactly as found
     * (their Yjs block and images included) and the live session as a JSON snapshot.
     */
    captureConflictSnapshotsInternal: (args2?: {
      diskText?: string | undefined;
      localRecords?: readonly DocumentRecord[] | undefined;
    }) => pendingWrites.track(async () => {
      assertEditable();
      await ensureLoaded();
      const rootDocId = rootDocIdRef.value;
      if (!rootDocId) throw new Error("Project is not initialized.");
      const diskText = args2?.diskText ?? (await readText(args.app, args.file));
      const localRecords = args2?.localRecords ?? [...cachedById.values()];
      const now = Date.now();
      await ensureProjectStorageDirs(rootDocId);
      await writeSnapshotAssets(rootDocId, localRecords);
      const conflictDir = resolveConflictsDir(rootDocId);
      const index = conflictIndexFor(rootDocId);
      // A side whose content an earlier conflict snapshot holds is not written again ("Cancel"
      // asks again on every save).
      let diskPath: string | null = null;
      if (diskText.trim()) {
        const fingerprint = await projectTextFingerprint(diskText);
        diskPath = `${conflictDir}/${await index.find(["external"], fingerprint) ?? await writeConflictGroupFile(rootDocId, "external", now, diskText, fingerprint)}`;
      }
      const localFingerprint = await projectRecordsContentFingerprint(localRecords);
      const existingLocal = await index.find(["local"], localFingerprint);
      const localPath = `${conflictDir}/${existingLocal ?? await writeConflictGroupFile(rootDocId, "local", now,
        encodeProjectDocsSnapshotV1({ rootDocId, capturedAt: now, records: localRecords }), localFingerprint)}`;
      if (!existingLocal) {
        try {
          const previewSvg = await args.preview.exportHistorySvg();
          const thumbnailPath = resolveHistoryThumbnailPath(localPath);
          if (previewSvg && thumbnailPath) await writeTextFileSafe(thumbnailPath, previewSvg);
        } catch {
          // A missing preview never weakens the snapshot itself.
        }
      }
      return { currentPath: localPath, ...(diskPath ? { diskPath } : {}) };
    }),
    /**
     * This device's version before a version written elsewhere replaces it (see the disk sync
     * port): once per content (a conflict session side with that content counts), the newest
     * `PROJECT_LOCAL_VERSION_SNAPSHOT_KEEP` kept, one being restored never deleted. The view that
     * edits calls it, or the one taking over editing while it holds the edit lock and is not yet
     * editable; read-only views never do.
     */
    preserveLocalVersionInternal: (args2: { localRecords: readonly DocumentRecord[] }) => pendingWrites.track(async () => {
      await ensureLoaded();
      const rootDocId = rootDocIdRef.value;
      if (!rootDocId) throw new Error("Project is not initialized.");
      await ensureProjectStorageDirs(rootDocId);
      await writeSnapshotAssets(rootDocId, args2.localRecords);
      const index = conflictIndexFor(rootDocId);
      const fingerprint = await projectRecordsContentFingerprint(args2.localRecords);
      if (await index.find(["device", "local"], fingerprint)) return;
      const now = Date.now();
      const conflictDir = resolveConflictsDir(rootDocId);
      const fileName = await writeConflictGroupFile(rootDocId, "device", now,
        encodeProjectDocsSnapshotV1({ rootDocId, capturedAt: now, records: args2.localRecords }), fingerprint);
      try {
        const previewSvg = await args.preview.exportHistorySvg();
        const thumbnailPath = resolveHistoryThumbnailPath(`${conflictDir}/${fileName}`);
        if (previewSvg && thumbnailPath) await writeTextFileSafe(thumbnailPath, previewSvg);
      } catch {
        // A missing preview never weakens the snapshot itself.
      }
      for (const oldName of planLocalVersionSnapshotRetention(await listConflictFileNames(rootDocId))) {
        const oldPath = `${conflictDir}/${oldName}`;
        if (isObsidianHistoryFileProtected(args.app, oldPath)) continue;
        await args.app.vault.adapter.remove(oldPath);
        index.forget(oldName);
        const previewPath = resolveHistoryThumbnailPath(oldPath);
        if (previewPath && await args.app.vault.adapter.exists(previewPath)) await args.app.vault.adapter.remove(previewPath);
      }
    }),
    rootDocIdRefInternal: rootDocIdRef,
    ensureLoadedInternal: ensureLoaded,
  };

  return store;
}

export function createObsidianHostAdapter(args: {
  app: App;
  file: TFile;
  editLease: Pick<ObsidianEditLease, "port" | "isEditable">;
  /** The file's text as the runtime read it to open the view: the store's first load. */
  openingText: string;
}): CreateObsidianHostAdapterResult {
  const storage = createLocalStoragePort();
  const dialog = createObsidianDialogPort(args.app);
  const files = createObsidianFilesPort({ app: args.app, baseFile: args.file });
  const external = createExternalPort();

  const clipboardApi = navigator?.clipboard;
  const ClipboardItemCtor = (globalThis as unknown as {
    ClipboardItem?:
      | ((new (items: Record<string, Blob | Promise<Blob>>) => ClipboardItem) & { supports?: ((format: string) => boolean) | undefined })
      | undefined;
  }).ClipboardItem;
  const eventWriteItems = typeof document?.execCommand === "function"
    ? createClipboardEventWriteItems(document)
    : undefined;
  const canWriteAsyncItems = typeof clipboardApi?.write === "function" && typeof ClipboardItemCtor === "function";
  const clipboard = clipboardApi
    ? createBrowserClipboardPort({
        readText: () => clipboardApi.readText(),
        writeText: (text) => clipboardApi.writeText(text),
        webCustomFormats: (typeof clipboardApi.read === "function" && canWriteAsyncItems) || Boolean(eventWriteItems),
        ...(typeof clipboardApi.read === "function"
          ? {
              async readItems() {
                const items = await clipboardApi.read();
                return items.map((item) => ({
                  types: item.types,
                  async readBytes(format: string) {
                    return new Uint8Array(await (await item.getType(format)).arrayBuffer());
                  },
                }));
              },
            }
          : {}),
        ...(canWriteAsyncItems || eventWriteItems
          ? {
              async writeItems(items) {
                if (eventWriteItems) {
                  try {
                    await eventWriteItems(items);
                    return;
                  } catch (error) {
                    if (!canWriteAsyncItems) throw error;
                  }
                }
                if (canWriteAsyncItems) {
                  const nativeItems = items.map((item) => {
                    const entries: Record<string, Blob | Promise<Blob>> = {};
                    for (const [format, bytes] of Object.entries(item.representations)) {
                      const mimeType = format.startsWith("web ") ? format.slice(4) : format;
                      entries[format] = bytes instanceof Uint8Array
                        ? new Blob([bytesToArrayBuffer(bytes)], { type: mimeType })
                        : Promise.resolve(bytes).then((resolved) => new Blob([bytesToArrayBuffer(resolved)], { type: mimeType }));
                    }
                    return new ClipboardItemCtor!(entries);
                  });
                  await clipboardApi.write(nativeItems);
                  return;
                }
                throw new Error("Clipboard item write is unavailable.");
              },
            }
          : {}),
        supportsFormat: (format) => typeof ClipboardItemCtor?.supports === "function" && ClipboardItemCtor.supports(format),
        isUserActivationActive: () => navigator.userActivation?.isActive ?? true,
      })
    : undefined;

  const preview = createPreviewBridge();
  const assetsIndex = createAssetIndex();
  const legacyAssets = new Map<string, Uint8Array>();
  const documents = createProjectDocumentStore({
    app: args.app, file: args.file, preview, assetsIndex, legacyAssets, isEditable: args.editLease.isEditable,
    deviceStorage: window.localStorage, openingText: args.openingText,
  });

  const ensureLoaded = async (): Promise<void> => {
    await (documents as unknown as { ensureLoadedInternal: () => Promise<void> }).ensureLoadedInternal();
  };
  const rootDocIdRef = (documents as unknown as { rootDocIdRefInternal: { value: DocumentId | null } }).rootDocIdRefInternal;

  const assets = createObsidianProjectAssetStore({ app: args.app, ensureLoaded, rootDocIdRef, assetsIndex, legacyAssets,
    trackWrite: (documents as typeof documents & { trackWriteInternal: ReturnType<typeof createObsidianPendingWrites>["track"] }).trackWriteInternal });
  const assetUrls = createObsidianAssetUrlPort({ assets, assetsIndex });
  const projectSnapshots: ProjectSnapshotsPort = {
    createPackageCheckpoint(args2) {
      const store = documents as unknown as {
        writeProjectCheckpointPackageInternal: (args: { tag: ProjectCheckpointTag; pinned: boolean; name: string | null }) => Promise<{ path: string }>;
      };
      return store.writeProjectCheckpointPackageInternal(args2);
    },
    completePackageCheckpoint(args2) {
      const store = documents as unknown as {
        completePackageCheckpointInternal: NonNullable<ProjectSnapshotsPort["completePackageCheckpoint"]>;
      };
      return store.completePackageCheckpointInternal(args2);
    },
  };
  type StoreInternals = {
    exportCurrentProjectTextInternal: () => Promise<{ text: string; payload: { rootDocId: DocumentId; revision: string } }>;
    captureConflictSnapshotsInternal: NonNullable<ProjectDiskSyncPort["captureConflictSnapshots"]>;
    preserveLocalVersionInternal: NonNullable<ProjectDiskSyncPort["preserveLocalVersion"]>;
    readDiskProjectVersionInternal: NonNullable<ProjectDiskSyncPort["readDiskProjectVersion"]>;
    prepareOverwriteDiskVersionInternal: NonNullable<ProjectDiskSyncPort["prepareOverwriteDiskVersion"]>;
    replaceProjectRecordsInternal: ProjectRecordsPort["replaceProjectRecords"];
  };
  const projectRecords: ProjectRecordsPort = {
    replaceProjectRecords(args2) {
      return (documents as unknown as StoreInternals).replaceProjectRecordsInternal(args2);
    },
  };
  const projectDiskSync: ProjectDiskSyncPort = {
    exportCurrentProjectText() {
      return (documents as unknown as StoreInternals).exportCurrentProjectTextInternal();
    },
    captureConflictSnapshots(args2) {
      return (documents as unknown as StoreInternals).captureConflictSnapshotsInternal(args2);
    },
    preserveLocalVersion(args2) {
      return (documents as unknown as StoreInternals).preserveLocalVersionInternal(args2);
    },
    readDiskProjectVersion(args2) {
      return (documents as unknown as StoreInternals).readDiskProjectVersionInternal(args2);
    },
    prepareOverwriteDiskVersion() {
      return (documents as unknown as StoreInternals).prepareOverwriteDiskVersionInternal();
    },
  };

  const capabilities: KmindCapabilities = {
    storage: {
      document: "host-api",
      trash: "none",
      assets: "host-api",
      kv: "local-storage",
    },
    files: { open: true, download: true },
    ui: { dialog: true },
    external: { openUrl: true },
    clipboard: {
      readText: Boolean(navigator?.clipboard?.readText),
      writeText: Boolean(navigator?.clipboard?.writeText),
      writeItems: Boolean(clipboard?.writeItems),
      readItems: clipboard?.capabilities?.readItems ?? false,
      writeItem: clipboard?.capabilities?.writeItem ?? false,
      webCustomFormats: clipboard?.capabilities?.webCustomFormats ?? false,
    },
  };

  const host: KmindHostAdapter = {
    id: "obsidian",
    capabilities,
    ports: {
      documents,
      assets,
      assetUrls,
      dialog,
      clipboard,
      storage,
      files,
      external,
      projectSnapshots,
      projectRecords,
      projectDiskSync,
      projectSaveIntegrity: (documents as unknown as { projectSaveIntegrityInternal: ProjectSaveIntegrityPort }).projectSaveIntegrityInternal,
      whiteboardConversion: (documents as unknown as { whiteboardConversionInternal: WhiteboardConversionPort }).whiteboardConversionInternal,
      projectEditLease: args.editLease.port,
      projectRecovery: createObsidianProjectRecovery({ app: args.app, file: args.file, files, openSourceFile: createObsidianRecoverySourcePicker(args.app) }),
    },
  };

  return { host, preview, lifecycle: {
    beginClose: () => (documents as typeof documents & { beginCloseInternal(): void }).beginCloseInternal(),
    hasPendingWrites: () => (documents as typeof documents & { hasPendingWritesInternal(): boolean }).hasPendingWritesInternal(),
    whenWritesIdle: () => (documents as typeof documents & { whenWritesIdleInternal(): Promise<void> }).whenWritesIdleInternal(),
    /** Before a waiting view starts editing: settles save transactions an earlier editing view left. Never throws. */
    prepareTakeover: () => (documents as typeof documents & { prepareTakeoverInternal(): Promise<void> }).prepareTakeoverInternal(),
  } };
}
