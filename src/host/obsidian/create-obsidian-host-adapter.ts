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
  ProjectCollabPort,
  ProjectCollabState,
  ProjectDiskSyncPort,
  ProjectSnapshotsPort,
} from "@kmind/app";
import {
  collectDocumentAssetStorageMeta,
  compressStaticRasterImageBytesToWebp,
  createZipStore,
  decodeBase64,
  DEFAULT_LOCAL_IMAGE_COMPRESSION_POLICY,
  encodeBase64,
  encodeKmindzProjectV3IntoSvgText,
  formatImageCompressionSize,
  isStaticRasterImageMimeType,
  normalizeMindMapExternalAssetStorage,
  parseKmindzProjectV3FromSvgText,
  readZipStore,
  resolveDefaultExternalUrlBehavior,
  shouldNotifyImageCompression,
  shouldStoreCompressedImageResult,
  upsertDocumentAssetStorageMeta,
} from "@kmind/app";
import { createKmindId, type AssetId } from "@kmind/core";
import { Notice, TFile, TFolder, type App, type TAbstractFile } from "obsidian";

import { sha256Hex, sha256HexFromString } from "../../storage/hash";
import { buildHistoryCheckpointFileName, parseHistoryCheckpointFileName } from "../../storage/history-snapshot-filename";
import { KMIND_ZEN_AUTO_HISTORY_KEEP, KMIND_ZEN_AUTO_HISTORY_MIN_INTERVAL_MS } from "../../storage/history-policy";
import { buildPlaceholderPreviewSvg } from "../../storage/placeholder-preview-svg";

import { createObsidianDialogPort } from "./obsidian-dialog";
import { createObsidianFilesPort } from "./obsidian-files";
import { bytesToArrayBuffer } from "../../storage/array-buffer";
import { kmindZenViewModesDefaultsStore } from "../../runtime/view-modes-defaults-store";

export type KmindPreviewBridge = {
  setExporter: (exporter: ((docId: DocumentId) => Promise<string | null>) | null) => void;
  exportSvg: (docId: DocumentId) => Promise<string | null>;
  setHistoryExporter: (exporter: (() => Promise<string | null>) | null) => void;
  exportHistorySvg: () => Promise<string | null>;
};

type CreateObsidianHostAdapterResult = {
  host: KmindHostAdapter;
  preview: KmindPreviewBridge;
};

type PreparedAssetRecord = {
  mimeType: string;
  bytes: Uint8Array;
  width?: number | undefined;
  height?: number | undefined;
};

function extFromMimeType(mimeType: string): string {
  const normalized = String(mimeType ?? "").toLowerCase();
  if (normalized.includes("svg")) return "svg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("avif")) return "avif";
  return "bin";
}

function isZhLocale(): boolean {
  const lang = String(globalThis.navigator?.language ?? "").toLowerCase();
  return lang.startsWith("zh");
}

function showImageCompressionNotice(args: {
  kind: "compressed" | "oversize" | "failed";
  originalSizeBytes?: number | undefined;
  compressedSizeBytes?: number | undefined;
}): void {
  const zh = isZhLocale();
  const suffix = zh ? "可在全局设置中关闭图片压缩。" : "You can turn image compression off in global settings.";
  const message = (() => {
    if (args.kind === "compressed" && typeof args.originalSizeBytes === "number" && typeof args.compressedSizeBytes === "number") {
      const from = formatImageCompressionSize(args.originalSizeBytes);
      const to = formatImageCompressionSize(args.compressedSizeBytes);
      return zh ? `已压缩 ${from} -> ${to}。${suffix}` : `Compressed ${from} -> ${to}. ${suffix}`;
    }
    if (args.kind === "oversize" && typeof args.originalSizeBytes === "number" && typeof args.compressedSizeBytes === "number") {
      const from = formatImageCompressionSize(args.originalSizeBytes);
      const to = formatImageCompressionSize(args.compressedSizeBytes);
      return zh
        ? `已压缩 ${from} -> ${to}，但图片仍偏大，导图性能可能受影响。${suffix}`
        : `Compressed ${from} -> ${to}, but the image is still large and may affect mind map performance. ${suffix}`;
    }
    return zh
      ? `图片过大，导图性能可能受影响。${suffix}`
      : `The image is large and may affect mind map performance. ${suffix}`;
  })();
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

async function writeText(app: App, file: TFile, text: string): Promise<void> {
  const adapter = app.vault.adapter;
  const targetPath = normalizeVaultPath(file.path);
  const base = targetPath.includes("/") ? targetPath.slice(targetPath.lastIndexOf("/") + 1) : targetPath;
  const dir = targetPath.includes("/") ? targetPath.slice(0, targetPath.lastIndexOf("/")) : "";
  const tmpName = `.${base}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tmpPath = dir ? `${dir}/${tmpName}` : tmpName;

  try {
    await adapter.write(tmpPath, text);
    await adapter.rename(tmpPath, targetPath);
  } catch (error) {
    try {
      await adapter.remove(tmpPath);
    } catch {
      // ignore
    }
    // Fallback to Obsidian's managed modify to keep the view/file cache consistent.
    await app.vault.modify(file, text);
  }
}

function createPreviewBridge(): KmindPreviewBridge {
  let exporter: ((docId: DocumentId) => Promise<string | null>) | null = null;
  let historyExporter: (() => Promise<string | null>) | null = null;
  return {
    setExporter(next) {
      exporter = next;
    },
    async exportSvg(docId) {
      try {
        return exporter ? await exporter(docId) : null;
      } catch {
        return null;
      }
    },
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

function createLocalStoragePort(prefix = "kmind-zen:"): KeyValueStoragePort {
  return {
    getItem(key) {
      try {
        return window.localStorage.getItem(`${prefix}${key}`);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        window.localStorage.setItem(`${prefix}${key}`, value);
      } catch {
        // ignore
      }
    },
    removeItem(key) {
      try {
        window.localStorage.removeItem(`${prefix}${key}`);
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

type CollabContext = {
  projectId: DocumentId;
  ydoc: unknown;
  collab: {
    createYDoc?: (() => unknown) | undefined;
    encodeYDocStateAsUpdate: (doc: unknown) => Uint8Array;
    applyYDocUpdate: (doc: unknown, update: Uint8Array, origin?: unknown) => void;
    listDocumentIdsInCrdt?: ((doc: unknown) => string[]) | undefined;
    deleteMindMapDocumentFromCrdt?: ((args: { ydoc: unknown; docId: string }) => void) | undefined;
    materializeMindMapDocumentFromCrdt: (args: { ydoc: unknown; docId: string }) => unknown;
    readDocumentRecordMetaFromCrdt?: ((args: { ydoc: unknown; docId: string }) => unknown) | undefined;
    upsertDocumentRecordMetaIntoCrdt?:
      | ((args: { ydoc: unknown; docId: string; meta: { title?: string | undefined; createdAt?: number | undefined } }) => unknown)
      | undefined;
    upsertMindMapDocumentIntoCrdt?: ((args: { ydoc: unknown; docId: string; doc: unknown }) => void) | undefined;
    replaceMindMapDocumentInCrdt?: ((args: { ydoc: unknown; docId: string; doc: unknown }) => void) | undefined;
  };
};

function createObsidianProjectAssetStore(args: {
  app: App;
  ensureLoaded: () => Promise<void>;
  rootDocIdRef: { value: DocumentId | null };
  assetsIndex: AssetIndex;
}): AssetStore {
  const memoryById = new Map<AssetId, { mimeType: string; bytes: Uint8Array }>();

  const ensureAssetsDirReady = async (rootDocId: DocumentId): Promise<void> => {
    await ensureDir(args.app, resolveAssetsDir(rootDocId));
  };

  const resolveAssetFile = (rootDocId: DocumentId, entry: KmindzSvgAssetEntryWithSizeV1): string => {
    return `${resolveAssetsDir(rootDocId)}/${entry.contentHash}.${entry.ext}`;
  };

  const readBinaryFile = async (path: string): Promise<Uint8Array | null> => {
    const abstract: TAbstractFile | null = args.app.vault.getAbstractFileByPath(path) as TAbstractFile | null;
    if (abstract instanceof TFile) {
      const buffer = await args.app.vault.readBinary(abstract);
      return new Uint8Array(buffer);
    }

    const adapter = args.app.vault.adapter;
    try {
      if (typeof adapter.readBinary === "function") {
        const buffer = await adapter.readBinary(path);
        return new Uint8Array(buffer);
      }
    } catch {
      // ignore
    }

    return null;
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
      const bytes = await readBinaryFile(path);
      if (bytes) {
        memoryById.delete(id);
        return { id, mimeType: indexed.entry.mimeType, bytes } satisfies AssetRecord;
      }
      const cached = memoryById.get(id) ?? null;
      if (!cached) return null;
      return { id, mimeType: cached.mimeType, bytes: cached.bytes } satisfies AssetRecord;
    },
    async put(record) {
      await args.ensureLoaded();
      const rootDocId = args.rootDocIdRef.value;
      if (!rootDocId) throw new Error("Project is not initialized.");
      await ensureAssetsDirReady(rootDocId);

      const stored = await prepareAssetForStorage(record);
      const ext = extFromMimeType(stored.mimeType);
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
    },
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

function createProjectDocumentStore(args: {
  app: App;
  file: TFile;
  preview: KmindPreviewBridge;
  deviceId: string;
  assetsIndex: AssetIndex;
}): DocumentStore {
  type DocsPackManifestV1 = {
    schemaVersion: 1;
    rootDocId: string;
    documents: Array<{ id: string; title: string; path: string }>;
  };

  type AssetsPackIndexV1 = {
    schemaVersion: 1;
    assets: Record<AssetId, { mimeType: string; contentHash: string; ext: string; size: number; path: string }>;
  };

  const UTF8_ENCODER = new TextEncoder();
  const UTF8_DECODER = new TextDecoder();
  const encodeUtf8 = (text: string) => UTF8_ENCODER.encode(text);
  const decodeUtf8 = (bytes: Uint8Array) => UTF8_DECODER.decode(bytes);

  const rootDocIdRef = { value: null as DocumentId | null };
  const expectedProjectRev = { value: null as string | null };
  const cachedById = new Map<DocumentId, DocumentRecord>();
  let loaded = false;
  let collabContext: CollabContext | null = null;

  let writeQueue: Promise<void> = Promise.resolve();
  const enqueueWrite = async (task: () => Promise<void>): Promise<void> => {
    const next = writeQueue.catch(() => {}).then(task);
    writeQueue = next.then(() => {}, () => {});
    return next;
  };

  const ensureProjectStorageDirs = async (rootDocId: DocumentId): Promise<void> => {
    await ensureDir(args.app, resolveProjectDir(rootDocId));
    await ensureDir(args.app, resolveAssetsDir(rootDocId));
    await ensureDir(args.app, resolveHistoryDir(rootDocId));
    await ensureDir(args.app, resolveCheckpointsDir(rootDocId));
    await ensureDir(args.app, resolveConflictsDir(rootDocId));
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

  const removeFileSafe = async (path: string): Promise<void> => {
    try {
      await args.app.vault.adapter.remove(path);
    } catch {
      // ignore
    }
  };

  const writeConflictSnapshots = async (args2: { rootDocId: DocumentId; diskUpdate: Uint8Array; localUpdate: Uint8Array; now: number }) => {
    await ensureProjectStorageDirs(args2.rootDocId);
    const conflictDir = resolveConflictsDir(args2.rootDocId);
    const externalPath = `${conflictDir}/${args2.now}_conflict_external.yjs`;
    const localPath = `${conflictDir}/${args2.now}_conflict_local.yjs`;
    await Promise.all([writeBinaryFile(externalPath, args2.diskUpdate), writeBinaryFile(localPath, args2.localUpdate)]);
    try {
      const previewSvg = await args.preview.exportHistorySvg();
      if (previewSvg) await writeTextFileSafe(localPath.replace(/\.yjs$/i, ".preview.svg"), previewSvg);
    } catch {
      // ignore
    }
    return { externalPath, localPath };
  };

  const writeCheckpointSnapshot = async (args2: { rootDocId: DocumentId; update: Uint8Array; now: number }): Promise<string> => {
    await ensureProjectStorageDirs(args2.rootDocId);
    const dir = resolveCheckpointsDir(args2.rootDocId);
    const fileName = buildHistoryCheckpointFileName({ ts: args2.now, tag: "auto", pinned: false, name: null });
    const path = `${dir}/${fileName}`;
    await writeBinaryFile(path, args2.update);
    try {
      const previewSvg = await args.preview.exportHistorySvg();
      if (previewSvg) await writeTextFileSafe(path.replace(/\.yjs$/i, ".preview.svg"), previewSvg);
    } catch {
      // ignore
    }
    return path;
  };

  const parseHistorySnapshotTs = (fileName: string): number | null => {
    if (!fileName.endsWith(".yjs")) return null;
    const baseName = fileName.replace(/\.yjs$/i, "");
    const match = baseName.match(/^(\d+)(?:[_-]|$)/);
    if (!match) return null;
    const ts = Number(match[1]);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return ts;
  };

  type AutoHistoryEntry = { path: string; ts: number };
  const autoHistoryCache = {
    loaded: false,
    latestTs: 0,
    entries: [] as AutoHistoryEntry[],
  };

  const readAutoHistoryEntries = async (rootDocId: DocumentId): Promise<AutoHistoryEntry[]> => {
    try {
      await ensureProjectStorageDirs(rootDocId);
      const dir = resolveCheckpointsDir(rootDocId);
      const listed = await args.app.vault.adapter.list(dir);
      const files = (listed.files ?? []).map(normalizeVaultPath);
      const out: AutoHistoryEntry[] = [];
      for (const fullPath of files) {
        const path = normalizeVaultPath(fullPath);
        if (!path.toLowerCase().endsWith(".yjs")) continue;
        const fileName = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
        const ts = parseHistorySnapshotTs(fileName);
        if (ts === null) continue;
        out.push({ path, ts });
      }
      return out;
    } catch {
      return [];
    }
  };

  const ensureAutoHistoryCache = async (rootDocId: DocumentId): Promise<void> => {
    if (autoHistoryCache.loaded) return;
    const existing = await readAutoHistoryEntries(rootDocId);
    autoHistoryCache.entries = existing;
    autoHistoryCache.latestTs = existing.reduce((acc, item) => (item.ts > acc ? item.ts : acc), 0);
    autoHistoryCache.loaded = true;
  };

  const pruneAutoHistoryEntries = async (): Promise<void> => {
    const keep = KMIND_ZEN_AUTO_HISTORY_KEEP;
    if (autoHistoryCache.entries.length <= keep) return;
    const sorted = [...autoHistoryCache.entries].sort((a, b) => b.ts - a.ts);
    const withPinned = sorted.map((item) => {
      const fileName = item.path.split("/").pop() ?? "";
      const pinned = parseHistoryCheckpointFileName(fileName).pinned;
      return { ...item, pinned };
    });
    const unpinned = withPinned.filter((item) => !item.pinned);
    if (unpinned.length <= keep) return;

    const toDelete = unpinned.slice(keep);
    autoHistoryCache.entries = unpinned.slice(0, keep);

    await Promise.all(
      toDelete.map(async (item) => {
        await Promise.all([
          removeFileSafe(item.path),
          removeFileSafe(item.path.replace(/\.yjs$/i, ".preview.svg")),
        ]);
      }),
    );
  };

  const maybeWriteAutoHistorySnapshot = async (args2: { rootDocId: DocumentId; content: string; now: number }): Promise<void> => {
    const trimmed = String(args2.content ?? "").trim();
    if (!trimmed) return;
    await ensureAutoHistoryCache(args2.rootDocId);

    const latestTs = autoHistoryCache.latestTs;
    const shouldWrite = latestTs === 0 || args2.now - latestTs >= KMIND_ZEN_AUTO_HISTORY_MIN_INTERVAL_MS;
    if (!shouldWrite) return;

    const bytes = decodeBase64(trimmed);
    const path = await writeCheckpointSnapshot({ rootDocId: args2.rootDocId, update: bytes, now: args2.now });
    autoHistoryCache.entries.push({ path, ts: args2.now });
    if (args2.now > autoHistoryCache.latestTs) autoHistoryCache.latestTs = args2.now;
    await pruneAutoHistoryEntries();
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
      const nextDoc = upsertDocumentAssetStorageMeta(record.doc, storageMetaByAssetId);
      if (nextDoc !== record.doc) docs.set(docId, { ...record, doc: nextDoc });
    }
    return docs;
  };

  const rebuildAssetIndexFromRecords = (records: Iterable<DocumentRecord>): void => {
    const previous = new Map(args.assetsIndex.byAssetId);
    args.assetsIndex.byAssetId.clear();
    for (const record of records) {
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

  const readDocsPack = (payload: KmindzProjectSvgPayloadV3): Map<DocumentId, DocumentRecord> => {
    const docsZipB64 = payload.docsZipB64;
    if (!docsZipB64) throw new Error("Invalid kmindz project file: missing docs pack (metadata#kmindz-docs).");
    const zipBytes = decodeBase64(docsZipB64);
    const zipMap = readZipStore(zipBytes);
    const manifestBytes = zipMap.get("manifest.json");
    if (!manifestBytes) throw new Error("Invalid kmindz docs pack: missing manifest.json.");
    const manifest = JSON.parse(decodeUtf8(manifestBytes)) as Partial<DocsPackManifestV1>;
    if (manifest.schemaVersion !== 1) throw new Error(`Unsupported kmindz docs pack schema: ${String(manifest.schemaVersion ?? "")}`);
    if (typeof manifest.rootDocId !== "string" || !manifest.rootDocId.trim()) throw new Error("Invalid kmindz docs pack: missing rootDocId.");

    const header = payload.header;
    const result = new Map<DocumentId, DocumentRecord>();
    for (const entry of manifest.documents ?? []) {
      if (!entry || typeof entry !== "object") continue;
      const id = String((entry as { id?: unknown }).id ?? "").trim() as DocumentId;
      const path = String((entry as { path?: unknown }).path ?? "").trim();
      if (!id || !path) continue;
      const docBytes = zipMap.get(path);
      if (!docBytes) throw new Error(`Invalid kmindz docs pack: missing doc file: ${path}`);
      const doc = JSON.parse(decodeUtf8(docBytes)) as DocumentRecord["doc"];

      const meta = header.documentsMeta[id];
      if (!meta) throw new Error(`Invalid kmindz header: missing documentsMeta for docId: ${id}`);

      result.set(id, {
        id,
        title: meta.title,
        doc,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        lastOpenedAt: meta.lastOpenedAt,
      });
    }

    if (!result.has(header.rootDocId)) {
      throw new Error(`Invalid kmindz docs pack: missing root doc. Root: ${header.rootDocId}`);
    }

    if (payload.collabUpdateB64) {
      const rootId = header.rootDocId;
      const rootRecord = result.get(rootId);
      if (rootRecord) {
        const projectCollab: ProjectCollabState = { kind: "yjs", schemaVersion: 1, yjsUpdateB64: payload.collabUpdateB64 };
        result.set(rootId, { ...rootRecord, projectCollab });
      }
    }

    return result;
  };

  const syncAssetsCacheFromPack = async (rootDocId: DocumentId, payload: KmindzProjectSvgPayloadV3): Promise<void> => {
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
      const mimeType = String((entry as { mimeType?: unknown }).mimeType ?? "").trim();
      const contentHash = String((entry as { contentHash?: unknown }).contentHash ?? "").trim();
      const ext = String((entry as { ext?: unknown }).ext ?? "").trim();
      const size = Number((entry as { size?: unknown }).size ?? 0);
      const path = String((entry as { path?: unknown }).path ?? "").trim();
      if (!mimeType || !contentHash || !ext || !path) continue;
      if (!Number.isFinite(size) || size < 0) continue;

      args.assetsIndex.upsert(assetId, { entry: { mimeType, contentHash, ext, size } });

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

  const hydrateFromPayload = async (payload: KmindzProjectSvgPayloadV3) => {
    cachedById.clear();
    rootDocIdRef.value = payload.header.rootDocId;
    expectedProjectRev.value = payload.header.rev;
    if (payload.header.assetsManifest) args.assetsIndex.loadFromManifest(payload.header.assetsManifest);

    const docs = injectEmbeddedAssetStorageIntoDocs(readDocsPack(payload), payload.header.assetsManifest);
    for (const [id, record] of docs.entries()) cachedById.set(id, record);

    rebuildAssetIndexFromRecords(cachedById.values());
    await syncAssetsCacheFromPack(payload.header.rootDocId, payload);
    loaded = true;
  };

  const ensureLoaded = async (): Promise<void> => {
    if (loaded) return;
    const text = await readText(args.app, args.file).catch(() => "");
    const payload = text ? parseKmindzProjectV3FromSvgText(text) : null;
    if (payload) {
      await hydrateFromPayload(payload);
      return;
    }
    if (text.trim().length > 0) throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
    loaded = true;
  };

  const buildAndWriteProjectFile = async (): Promise<void> => {
    const now = Date.now();
    const rootDocId = rootDocIdRef.value;
    if (!rootDocId) throw new Error("Project is not initialized.");

    await ensureProjectStorageDirs(rootDocId);

    const existingText = await readText(args.app, args.file).catch(() => "");
    const existingPayload = existingText ? parseKmindzProjectV3FromSvgText(existingText) : null;
    if (existingText.trim().length > 0 && !existingPayload) {
      throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
    }
    const currentRev = existingPayload ? existingPayload.header.rev : null;

    const expected = expectedProjectRev.value;
    if (expected && currentRev && currentRev !== expected) {
      const diskUpdate = existingPayload?.collabUpdateB64 ? decodeBase64(existingPayload.collabUpdateB64) : null;
      const localUpdate = collabContext ? collabContext.collab.encodeYDocStateAsUpdate(collabContext.ydoc) : null;
      const canApply = Boolean(diskUpdate && collabContext && collabContext.projectId === rootDocId);

      let applied = false;
      if (canApply && diskUpdate) {
        try {
          collabContext!.collab.applyYDocUpdate(collabContext!.ydoc, diskUpdate, { kind: "kmind-yjs:disk" });
          applied = true;
        } catch {
          applied = false;
        }
      }

      if (!diskUpdate || !localUpdate || !collabContext) {
        throw new Error("Save conflict detected, but CRDT is not available to capture/merge snapshots.");
      }
      if (!canApply || !applied) {
        const conflicts = await writeConflictSnapshots({ rootDocId, diskUpdate, localUpdate, now });
        throw new Error(`Save conflict detected. CRDT snapshots written to: ${conflicts.externalPath}, ${conflicts.localPath}`);
      }
    }
    if (!expected && currentRev) expectedProjectRev.value = currentRev;

    const documents = Object.fromEntries(cachedById.entries()) as Record<DocumentId, DocumentRecord>;

    const docsFromCollab = (() => {
      if (!collabContext || collabContext.projectId !== rootDocId) {
        return { documents, collabUpdateB64: null as string | null, collabHash: null as string | null };
      }
      const nextDocs: Record<DocumentId, DocumentRecord> = {};
      const materialize = collabContext.collab.materializeMindMapDocumentFromCrdt;
      const upsert = collabContext.collab.upsertMindMapDocumentIntoCrdt;
      for (const record of Object.values(documents)) {
        let materialized: unknown = null;
        if (typeof materialize === "function") {
          try {
            materialized = materialize({ ydoc: collabContext.ydoc, docId: record.id });
          } catch {
            materialized = null;
          }
        }
        if (!materialized && typeof materialize === "function" && typeof upsert === "function") {
          try {
            upsert({ ydoc: collabContext.ydoc, docId: record.id, doc: record.doc });
            materialized = materialize({ ydoc: collabContext.ydoc, docId: record.id });
          } catch {
            materialized = null;
          }
        }
        nextDocs[record.id] = materialized ? { ...record, doc: materialized as DocumentRecord["doc"] } : record;
      }
      const updateBytes = collabContext.collab.encodeYDocStateAsUpdate(collabContext.ydoc);
      const collabUpdateB64 = encodeBase64(updateBytes);
      const collabHash = sha256Hex(updateBytes);
      const rootRecord = nextDocs[rootDocId];
      if (rootRecord) {
        const projectCollab: ProjectCollabState = { kind: "yjs", schemaVersion: 1, yjsUpdateB64: collabUpdateB64 };
        nextDocs[rootDocId] = { ...rootRecord, projectCollab };
      }
      return { documents: nextDocs, collabUpdateB64, collabHash };
    })();

    const docs = docsFromCollab.documents;

    const docsManifest: DocsPackManifestV1 = {
      schemaVersion: 1,
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
    const docsHash = sha256Hex(docsZipBytes);

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
    const assetsManifest: Record<AssetId, KmindzSvgAssetEntryWithSizeV1> = {};
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
      args.assetsIndex.upsert(assetId, { entry });
      assetsManifest[assetId] = entry;
    }

    const existingAssetsManifest = existingPayload?.header.assetsManifest;
    const assetsManifestChanged = serializeAssetsManifest(existingAssetsManifest) !== serializeAssetsManifest(assetsManifest);

    let assetsZipB64: string | null = null;
    let assetsHash: string | null = null;
    if (!assetsManifestChanged && existingPayload?.assetsZipB64) {
      assetsZipB64 = existingPayload.assetsZipB64;
      assetsHash = existingPayload.header.hashes?.assets ?? null;
    } else if (Object.keys(assetsManifest).length > 0) {
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
      for (const entry of Object.values(index.assets)) {
        if (!entry?.path) continue;
        if (uniqueByPath.has(entry.path)) continue;
        const cachedPath = `${resolveAssetsDir(rootDocId)}/${entry.contentHash}.${entry.ext}`;
        // eslint-disable-next-line no-await-in-loop
        const bytes = await readBinaryFile(cachedPath);
        uniqueByPath.set(entry.path, bytes);
      }
      for (const [path, bytes] of Array.from(uniqueByPath.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        files.push({ path, bytes });
      }
      const assetsZipBytes = createZipStore(files);
      assetsZipB64 = encodeBase64(assetsZipBytes);
      assetsHash = sha256Hex(assetsZipBytes);
    }

    const documentsMeta = Object.fromEntries(
      Object.values(docs).map((record) => [
        record.id,
        {
          id: record.id,
          title: record.title,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          lastOpenedAt: record.lastOpenedAt,
        },
      ]),
    ) as KmindzProjectSvgHeaderV3["documentsMeta"];

    const contentRev = await sha256HexFromString(
      JSON.stringify({
        rootDocId,
        collab: docsFromCollab.collabHash ?? null,
        docs: docsHash,
        assets: assetsHash,
      }),
    );

    const rootRecord = docs[rootDocId];
    const fallbackNow = now;
    const header: KmindzProjectSvgHeaderV3 = {
      format: "kmindz-project-svg",
      version: 3,
      mapKey: rootDocId,
      rootDocId,
      createdAt: rootRecord?.createdAt ?? fallbackNow,
      updatedAt: fallbackNow,
      lastOpenedAt: Math.max(...Object.values(docs).map((r) => r.lastOpenedAt ?? 0), fallbackNow),
      rev: contentRev,
      documentsMeta,
      assetsManifest: Object.keys(assetsManifest).length > 0 ? assetsManifest : undefined,
      hashes: { collab: docsFromCollab.collabHash ?? undefined, docs: docsHash, assets: assetsHash ?? undefined },
      host: { kind: "obsidian" },
    };

    for (const record of Object.values(docs)) cachedById.set(record.id, record);
    expectedProjectRev.value = header.rev;

    if (docsFromCollab.collabUpdateB64) {
      try {
        await maybeWriteAutoHistorySnapshot({ rootDocId, content: docsFromCollab.collabUpdateB64, now });
      } catch {
        // ignore
      }
    }

    const shouldReuseExistingPreview = Boolean(existingText && existingPayload && existingPayload.header.rev === header.rev);
    const exportedPreview = shouldReuseExistingPreview ? null : await args.preview.exportSvg(header.rootDocId);
    const previewSvg = exportedPreview ?? existingText ?? buildPlaceholderPreviewSvg({ title: docs[rootDocId]?.title ?? "KMind", subtitle: "KMind Zen (.kmindz)" });

    const nextText = encodeKmindzProjectV3IntoSvgText({
      previewSvg,
      header,
      collabUpdateB64: docsFromCollab.collabUpdateB64,
      docsZipB64,
      assetsZipB64,
    });

    await writeText(args.app, args.file, nextText);
    expectedProjectRev.value = header.rev;
  };

  const syncRecordMetaToCrdt = (record: DocumentRecord): void => {
    const rootDocId = rootDocIdRef.value;
    if (!rootDocId) return;
    if (!collabContext || collabContext.projectId !== rootDocId) return;
    const upsertMeta = collabContext.collab.upsertDocumentRecordMetaIntoCrdt;
    if (typeof upsertMeta !== "function") return;
    try {
      upsertMeta({
        ydoc: collabContext.ydoc,
        docId: record.id,
        meta: {
          title: record.title,
          createdAt: record.createdAt,
        },
      });
    } catch {
      // ignore
    }
  };

  const deleteDocumentFromCrdt = (docId: DocumentId): void => {
    const rootDocId = rootDocIdRef.value;
    if (!rootDocId) return;
    if (!collabContext || collabContext.projectId !== rootDocId) return;
    const del = collabContext.collab.deleteMindMapDocumentFromCrdt;
    if (typeof del !== "function") return;
    try {
      del({ ydoc: collabContext.ydoc, docId });
    } catch {
      // ignore
    }
  };

  function deepEqualJson(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;

    if (typeof a === "number" && typeof b === "number") {
      if (Number.isNaN(a) && Number.isNaN(b)) return true;
      return false;
    }

    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        if (!deepEqualJson(a[i], b[i])) return false;
      }
      return true;
    }

    if (typeof a === "object") {
      if (Array.isArray(b)) return false;
      const left = a as Record<string, unknown>;
      const right = b as Record<string, unknown>;

      const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
      const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
      if (leftKeys.length !== rightKeys.length) return false;

      for (const key of leftKeys) {
        if (right[key] === undefined) return false;
        if (!deepEqualJson(left[key], right[key])) return false;
      }
      return true;
    }

    return false;
  }

  const maybeSyncDocumentToCrdt = (record: DocumentRecord): void => {
    const rootDocId = rootDocIdRef.value;
    if (!rootDocId) return;
    if (!collabContext || collabContext.projectId !== rootDocId) return;

    const materialize = collabContext.collab.materializeMindMapDocumentFromCrdt;
    const upsert = collabContext.collab.upsertMindMapDocumentIntoCrdt;
    const replace = collabContext.collab.replaceMindMapDocumentInCrdt;
    if (typeof materialize !== "function") return;
    if (typeof replace !== "function") return;

    const existing = (() => {
      try {
        return materialize({ ydoc: collabContext.ydoc, docId: record.id }) as unknown;
      } catch {
        return null;
      }
    })();

    if (!existing) {
      if (typeof upsert !== "function") return;
      try {
        upsert({ ydoc: collabContext.ydoc, docId: record.id, doc: record.doc });
      } catch {
        // ignore
      }
      return;
    }

    if (deepEqualJson(existing, record.doc)) return;

    const ydoc = collabContext.ydoc as unknown as { transact?: ((fn: () => void, origin?: unknown) => void) | undefined };
    const apply = () => replace({ ydoc: collabContext.ydoc, docId: record.id, doc: record.doc });
    if (typeof ydoc?.transact === "function") {
      ydoc.transact(apply, { kind: "kmind-crdt:documents-put" });
    } else {
      apply();
    }
  };

  const store = {
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
        await ensureLoaded();
        if (!rootDocIdRef.value) rootDocIdRef.value = record.id;
        cachedById.set(record.id, record);
        syncRecordMetaToCrdt(record);
        maybeSyncDocumentToCrdt(record);
        await buildAndWriteProjectFile();
      });
    },
    async delete(id: DocumentId) {
      await enqueueWrite(async () => {
        await ensureLoaded();
        const rootDocId = rootDocIdRef.value;
        if (rootDocId && id === rootDocId) {
          await args.app.vault.delete(args.file, true);
          cachedById.clear();
          expectedProjectRev.value = null;
          rootDocIdRef.value = null;
          autoHistoryCache.loaded = false;
          autoHistoryCache.latestTs = 0;
          autoHistoryCache.entries = [];
          loaded = false;
          return;
        }
        cachedById.delete(id);
        deleteDocumentFromCrdt(id);
        await buildAndWriteProjectFile();
      });
    },
    forceReloadFromDisk: async () => {
      loaded = false;
      autoHistoryCache.loaded = false;
      autoHistoryCache.latestTs = 0;
      autoHistoryCache.entries = [];
      await ensureLoaded();
    },
    readProjectFileTextInternal: async (): Promise<string> => {
      await ensureLoaded();
      return await readText(args.app, args.file).catch(() => "");
    },
    writeProjectCheckpointPackageInternal: async (args2: { tag: "manual" | "before-restore" | "before-import"; pinned: boolean; name: string | null }) => {
      await ensureLoaded();
      const rootDocId = rootDocIdRef.value;
      if (!rootDocId) throw new Error("Project is not initialized.");
      const text = (await readText(args.app, args.file).catch(() => "")) ?? "";
      if (!text.trim()) throw new Error("Project file is empty; cannot create package checkpoint.");
      const checkpointsDir = resolveCheckpointsDir(rootDocId);
      await ensureDir(args.app, checkpointsDir);
      const fileName = buildHistoryCheckpointFileName({
        ts: Date.now(),
        tag: args2.tag,
        pinned: args2.pinned,
        name: args2.name,
        storageFormat: "package",
      });
      const path = `${checkpointsDir}/${fileName}`;
      await args.app.vault.adapter.write(path, text);
      return { path };
    },
    setProjectCollabContextInternal: (ctx: CollabContext | null) => {
      collabContext = ctx;
      if (!ctx) return;
      enqueueWrite(async () => {
        await ensureLoaded();
        if (collabContext !== ctx) return;
        for (const record of cachedById.values()) {
          maybeSyncDocumentToCrdt(record);
          syncRecordMetaToCrdt(record);
        }
      }).catch(() => undefined);
    },
    restoreFromYjsUpdateInternal: async (args2: { update: Uint8Array }) => {
      let restoredDocIds: DocumentId[] = [];
      await enqueueWrite(async () => {
        await ensureLoaded();
        const rootDocId = rootDocIdRef.value;
        if (!rootDocId) throw new Error("Project is not initialized.");
        if (!collabContext || collabContext.projectId !== rootDocId) {
          throw new Error("CRDT context is not available for restoring snapshots.");
        }

        const create = collabContext.collab.createYDoc;
        if (typeof create !== "function") throw new Error("Collab runtime does not support createYDoc().");
        const listDocIds = collabContext.collab.listDocumentIdsInCrdt;
        const replace = collabContext.collab.replaceMindMapDocumentInCrdt;
        if (
          typeof listDocIds !== "function" ||
          typeof collabContext.collab.deleteMindMapDocumentFromCrdt !== "function" ||
          typeof replace !== "function"
        ) {
          throw new Error("Collab runtime does not support list/delete/replace for CRDT restore.");
        }
        const readRecordMeta =
          typeof collabContext.collab.readDocumentRecordMetaFromCrdt === "function" ? collabContext.collab.readDocumentRecordMetaFromCrdt : null;

        const tmp = create();
        collabContext.collab.applyYDocUpdate(tmp, args2.update, { kind: "kmind-yjs:restore" });

        const now = Date.now();
        const snapshotDocIds = listDocIds(tmp) as DocumentId[];
        if (!snapshotDocIds.includes(rootDocId)) {
          throw new Error(`Invalid checkpoint: missing rootDocId in CRDT snapshot: ${rootDocId}`);
        }
        restoredDocIds = snapshotDocIds;

        const resolveTitleFromDoc = (doc: DocumentRecord["doc"]): string => {
          const roots = Array.isArray(doc?.roots) ? doc.roots : [];
          const rootId = roots.length > 0 ? roots[0] : null;
          const node = rootId ? doc?.nodes?.[rootId] : null;
          const text = typeof node?.text === "string" ? node.text.trim() : "";
          return text || "Untitled";
        };

        const existingById = Object.fromEntries(cachedById.entries()) as Record<DocumentId, DocumentRecord>;
        const nextDocs: Record<DocumentId, DocumentRecord> = {};

        for (const docId of snapshotDocIds) {
          const materialized = collabContext.collab.materializeMindMapDocumentFromCrdt({ ydoc: tmp, docId });
          if (!materialized) {
            throw new Error(`Invalid checkpoint: missing CRDT document: ${docId}`);
          }

          const meta = (() => {
            if (!readRecordMeta) return null;
            try {
              const raw = readRecordMeta({ ydoc: tmp, docId }) as { schemaVersion?: unknown; title?: unknown; createdAt?: unknown } | null;
              if (!raw || raw.schemaVersion !== 1) return null;
              const title = typeof raw.title === "string" ? raw.title.trim() : "";
              const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
              if (!title || createdAt <= 0) return null;
              return { title, createdAt } as const;
            } catch {
              return null;
            }
          })();

          const prev = existingById[docId] ?? null;
          const doc = materialized as DocumentRecord["doc"];
          nextDocs[docId] = {
            id: docId,
            title: meta?.title ?? prev?.title ?? resolveTitleFromDoc(doc),
            doc,
            createdAt: meta?.createdAt ?? prev?.createdAt ?? now,
            updatedAt: now,
            lastOpenedAt: prev?.lastOpenedAt ?? now,
            projectCollab: prev?.projectCollab,
          };
        }

        const snapshotSet = new Set<DocumentId>(snapshotDocIds);
        const currentDocIds = listDocIds(collabContext.ydoc) as DocumentId[];
        for (const docId of currentDocIds) {
          if (snapshotSet.has(docId)) continue;
          deleteDocumentFromCrdt(docId);
        }

        for (const record of Object.values(nextDocs)) {
          replace({ ydoc: collabContext.ydoc, docId: record.id, doc: record.doc });
          syncRecordMetaToCrdt(record);
        }

        cachedById.clear();
        for (const record of Object.values(nextDocs)) cachedById.set(record.id, record);
        rebuildAssetIndexFromRecords(Object.values(nextDocs));
        await buildAndWriteProjectFile();
      });
      return { docIds: restoredDocIds };
    },
    mergeExternalDiskChangeInternal: async (args2?: { diskText?: string | undefined }) => {
      await ensureLoaded();
      const diskText = args2?.diskText ?? (await readText(args.app, args.file).catch(() => ""));
      const payload = diskText ? parseKmindzProjectV3FromSvgText(diskText) : null;
      if (!payload) {
        if (diskText.trim().length > 0) throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
        return { ok: true as const, applied: false as const, reason: "empty" as const };
      }

      const diskRev = payload.header.rev ?? null;
      if (diskRev && expectedProjectRev.value && diskRev === expectedProjectRev.value) {
        await hydrateFromPayload(payload);
        return { ok: true as const, applied: false as const, reason: "same-rev" as const };
      }

      const updateB64 = String(payload.collabUpdateB64 ?? "").trim();
      const canApply = Boolean(updateB64 && collabContext && collabContext.projectId === payload.header.rootDocId);
      if (canApply) {
        try {
          collabContext!.collab.applyYDocUpdate(collabContext!.ydoc, decodeBase64(updateB64), { kind: "kmind-yjs:disk" });
        } catch {
          // ignore and fall back to hydrate only
        }
      }

      await hydrateFromPayload(payload);
      const reason = (() => {
        if (canApply) return undefined;
        if (!updateB64) return "missing-collab-update" as const;
        if (!collabContext) return "missing-collab-context" as const;
        return "collab-project-mismatch" as const;
      })();
      return { ok: true as const, applied: canApply, reason };
    },
    exportCurrentProjectTextInternal: async () => {
      await ensureLoaded();
      const existingText = await readText(args.app, args.file).catch(() => "");
      if (existingText.trim().length > 0 && !parseKmindzProjectV3FromSvgText(existingText)) {
        throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
      }
      const now = Date.now();
      await enqueueWrite(async () => {});
      return { text: existingText, payload: { rootDocId: rootDocIdRef.value ?? ("" as DocumentId) } };
    },
    captureConflictSnapshotsInternal: async (args2?: { diskText?: string | undefined; force?: boolean | undefined }) => {
      await ensureLoaded();
      const rootDocId = rootDocIdRef.value;
      if (!rootDocId) throw new Error("Project is not initialized.");
      const diskText = args2?.diskText ?? (await readText(args.app, args.file).catch(() => ""));
      const diskPayload = diskText ? parseKmindzProjectV3FromSvgText(diskText) : null;
      const diskUpdate = diskPayload?.collabUpdateB64 ? decodeBase64(diskPayload.collabUpdateB64) : null;
      const localUpdate = collabContext ? collabContext.collab.encodeYDocStateAsUpdate(collabContext.ydoc) : null;
      if (!diskUpdate || !localUpdate || !collabContext) return null;
      if (collabContext.projectId !== rootDocId) return null;
      return writeConflictSnapshots({ rootDocId, diskUpdate, localUpdate, now: Date.now() });
    },
    forceWriteCurrentProjectToDiskInternal: async () => {
      await enqueueWrite(async () => {
        await ensureLoaded();
        await buildAndWriteProjectFile();
      });
    },
    rootDocIdRefInternal: rootDocIdRef,
    ensureLoadedInternal: ensureLoaded,
  };

  return store;
}

function resolveDeviceId(storage: KeyValueStoragePort | null | undefined): string {
  const existing = (() => {
    try {
      return storage?.getItem("deviceId") ?? null;
    } catch {
      return null;
    }
  })();
  if (typeof existing === "string" && existing.trim()) return existing;

  const id = createKmindId("device");
  try {
    storage?.setItem("deviceId", id);
  } catch {
    // ignore
  }
  return id;
}

export function createObsidianHostAdapter(args: { app: App; file: TFile }): CreateObsidianHostAdapterResult {
  const storage = createLocalStoragePort();
  const deviceId = resolveDeviceId(storage);
  const dialog = createObsidianDialogPort(args.app);
  const files = createObsidianFilesPort({ app: args.app, baseFile: args.file });
  const external = createExternalPort();

  const clipboardApi = navigator?.clipboard;
  const ClipboardItemCtor = (globalThis as unknown as {
    ClipboardItem?: (new (items: Record<string, Blob>) => unknown) | undefined;
  }).ClipboardItem;
  const canWriteClipboardItems = Boolean(clipboardApi?.write) && typeof ClipboardItemCtor === "function";
  const clipboard = clipboardApi
    ? {
        readText: () => clipboardApi.readText(),
        writeText: (text: string) => clipboardApi.writeText(text),
        ...(canWriteClipboardItems
          ? {
              async writeItems(items: Array<{ mimeType: string; bytes: Uint8Array }>) {
                const entries: Record<string, Blob> = {};
                for (const item of items) {
                  entries[item.mimeType] = new Blob([item.bytes], { type: item.mimeType });
                }
                await clipboardApi.write([new ClipboardItemCtor!(entries) as ClipboardItem]);
              },
            }
          : {}),
      }
    : undefined;

  const preview = createPreviewBridge();
  const assetsIndex = createAssetIndex();
  const documents = createProjectDocumentStore({ app: args.app, file: args.file, preview, deviceId, assetsIndex });

  const ensureLoaded = async (): Promise<void> => {
    await (documents as unknown as { ensureLoadedInternal: () => Promise<void> }).ensureLoadedInternal();
  };
  const rootDocIdRef = (documents as unknown as { rootDocIdRefInternal: { value: DocumentId | null } }).rootDocIdRefInternal;

  const assets = createObsidianProjectAssetStore({ app: args.app, ensureLoaded, rootDocIdRef, assetsIndex });
  const assetUrls = createObsidianAssetUrlPort({ assets, assetsIndex });
  const projectSnapshots: ProjectSnapshotsPort = {
    createPackageCheckpoint(args2) {
      const store = documents as unknown as {
        writeProjectCheckpointPackageInternal: (args: { tag: "manual" | "before-restore" | "before-import"; pinned: boolean; name: string | null }) => Promise<{ path: string }>;
      };
      return store.writeProjectCheckpointPackageInternal(args2);
    },
  };
  const projectCollab: ProjectCollabPort = {
    setContext(ctx) {
      const store = documents as unknown as { setProjectCollabContextInternal: (value: typeof ctx) => void };
      store.setProjectCollabContextInternal(ctx);
    },
    restoreFromYjsUpdate(args2) {
      const store = documents as unknown as { restoreFromYjsUpdateInternal: (args: { update: Uint8Array }) => Promise<{ docIds: DocumentId[] }> };
      return store.restoreFromYjsUpdateInternal(args2);
    },
  };
  const projectDiskSync: ProjectDiskSyncPort = {
    reloadFromDisk() {
      const store = documents as unknown as { forceReloadFromDisk?: (() => Promise<void>) | undefined };
      return typeof store.forceReloadFromDisk === "function" ? store.forceReloadFromDisk() : Promise.resolve();
    },
    mergeExternalDiskChange(args2) {
      const store = documents as unknown as {
        mergeExternalDiskChangeInternal?: ((args?: { diskText?: string | undefined }) => Promise<{ ok: true; applied: boolean; reason?: string }>) | undefined;
      };
      return typeof store.mergeExternalDiskChangeInternal === "function"
        ? store.mergeExternalDiskChangeInternal(args2)
        : Promise.resolve({ ok: true as const, applied: false, reason: "unsupported" });
    },
    exportCurrentProjectText() {
      const store = documents as unknown as {
        exportCurrentProjectTextInternal?: (() => Promise<{ text: string; payload: { rootDocId: DocumentId } }>) | undefined;
      };
      if (typeof store.exportCurrentProjectTextInternal !== "function") {
        return Promise.reject(new Error("Project export text API is not available in the current host adapter."));
      }
      return store.exportCurrentProjectTextInternal();
    },
    captureConflictSnapshots(args2) {
      const store = documents as unknown as {
        captureConflictSnapshotsInternal?: ((args?: { diskText?: string | undefined; force?: boolean | undefined }) => Promise<unknown>) | undefined;
      };
      return typeof store.captureConflictSnapshotsInternal === "function" ? store.captureConflictSnapshotsInternal(args2) : Promise.resolve(undefined);
    },
    forceWriteCurrentProjectToDisk() {
      const store = documents as unknown as { forceWriteCurrentProjectToDiskInternal?: (() => Promise<void>) | undefined };
      if (typeof store.forceWriteCurrentProjectToDiskInternal !== "function") {
        return Promise.reject(new Error("Force write API is not available in the current host adapter."));
      }
      return store.forceWriteCurrentProjectToDiskInternal();
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
    },
    ocr: { textRecognition: "unavailable" },
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
      projectCollab,
      projectDiskSync,
    },
  };

  return { host, preview };
}
