import { projectProtectionError } from "@kmind/app";
import {
  decodeBase64,
  inspectProjectDurableSnapshot,
  readZipStore,
  type DocumentRecord,
  type KmindzProjectSvgPayloadV3,
  type ProjectDurableDescriptor,
  type ProjectUnusedAssetPolicy,
} from "@kmind/app";
import { sha256Hex } from "../../storage/hash";

/** File-format validation only; the adapter retains document decoding ownership. */
export async function inspectObsidianProjectIntegrity(args: {
  text: string;
  payload: KmindzProjectSvgPayloadV3;
  readDocuments: () => readonly DocumentRecord[];
  unusedAssets?: { policy: ProjectUnusedAssetPolicy; establishBaseline?: boolean };
}): Promise<ProjectDurableDescriptor> {
  const { payload } = args;
  if (!payload.docsZipB64 || !payload.header.hashes?.docs) throw projectProtectionError("external-invalid", "Project documents pack or integrity hash is missing.");
  for (const [body, fingerprint] of [
    [payload.docsZipB64, payload.header.hashes.docs],
    [payload.collabUpdateB64, payload.header.hashes.collab],
    [payload.assetsZipB64, payload.header.hashes.assets],
  ]) {
    if (body && (!fingerprint || await sha256Hex(decodeBase64(body)) !== fingerprint)) {
      throw projectProtectionError("external-invalid", "Project package component hash verification failed.");
    }
  }
  const manifest = payload.header.assetsManifest ?? {};
  if (Object.keys(manifest).length > 0 && !payload.assetsZipB64) {
    throw projectProtectionError("assets-invalid", "Project asset package is missing.");
  }
  if (payload.assetsZipB64) {
    const zip = readZipStore(decodeBase64(payload.assetsZipB64), { copy: false });
    const indexBytes = zip.get("index.json");
    if (!indexBytes) throw projectProtectionError("assets-invalid", "Project asset index is missing.");
    const index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(indexBytes));
    if (index?.schemaVersion !== 1 || !index.assets || typeof index.assets !== "object" || Array.isArray(index.assets)) {
      throw projectProtectionError("assets-invalid", "Project asset index is invalid.");
    }
    if (Object.keys(index.assets).length !== Object.keys(manifest).length) throw projectProtectionError("assets-invalid", "Project asset index differs from manifest.");
    const verified = new Map<string, string>();
    const invalidIds = new Set<string>();
    for (const [id, entry] of Object.entries(manifest)) {
      const indexed = index.assets[id];
      if (!entry || !/^[a-f0-9]{64}$/u.test(entry.contentHash) || !/^[a-zA-Z0-9]+$/u.test(entry.ext)
        || !Number.isSafeInteger(entry.size) || entry.size < 0 || !entry.mimeType
        || !indexed || indexed.contentHash !== entry.contentHash || indexed.ext !== entry.ext
        || indexed.size !== entry.size || indexed.mimeType !== entry.mimeType) {
        throw projectProtectionError("assets-invalid", "Project asset metadata verification failed.");
      }
      const path = indexed.path;
      const legacyIdPath = id !== "." && id !== ".." && !/[/\\\u0000-\u001f]/u.test(id) ? `assets/${id}` : null;
      if (path !== `assets/${entry.contentHash}.${entry.ext}` && path !== legacyIdPath) {
        throw projectProtectionError("assets-invalid", "Project asset bytes are missing or truncated.");
      }
      const bytes = zip.get(path);
      if (!bytes && args.unusedAssets) {
        invalidIds.add(id);
        continue;
      }
      if (bytes && bytes.byteLength !== entry.size && args.unusedAssets) {
        invalidIds.add(id);
        continue;
      }
      if (!bytes || bytes.byteLength !== entry.size) {
        throw projectProtectionError("assets-invalid", "Project asset bytes are missing or truncated.");
      }
      let fingerprint = verified.get(path);
      if (!fingerprint) {
        fingerprint = await sha256Hex(bytes);
        verified.set(path, fingerprint);
      }
      if (fingerprint !== entry.contentHash) {
        if (args.unusedAssets) invalidIds.add(id);
        else throw projectProtectionError("assets-invalid", "Project asset content hash verification failed.");
      }
    }
    if (args.unusedAssets) {
      const records = args.readDocuments().map(record => ({ ...record, doc: { ...record.doc,
        assets: Object.fromEntries(Object.entries(record.doc.assets ?? {}).map(([id, asset]) => {
          const entry = manifest[id];
          if (entry && (asset.kind === "image" || asset.kind === "blob") && asset.storage && (
            asset.storage.kind !== "external-v1" || asset.storage.contentHash.toLowerCase() !== entry.contentHash.toLowerCase()
            || asset.storage.ext.toLowerCase() !== entry.ext.toLowerCase()
            || (asset.storage.size !== undefined && asset.storage.size !== entry.size)
          )) throw projectProtectionError("assets-invalid", "Document and package resource metadata disagree.");
          return [id, entry && (asset.kind === "image" || asset.kind === "blob") && !asset.storage
            ? { ...asset, storage: { kind: "external-v1" as const, contentHash: entry.contentHash, ext: entry.ext, size: entry.size } } : asset];
        })),
      } }));
      await args.unusedAssets.policy.validate({ records, readExternalAsset: async request => ({ bytes: zip.get(index.assets[request.assetId]?.path) ?? null }) }, { establishBaseline: Boolean(args.unusedAssets.establishBaseline) });
      for (const id of invalidIds) if (!args.unusedAssets.policy.permitsAnomaly(id)) {
        throw projectProtectionError("assets-invalid", "Unowned missing resource cannot be exempted.");
      }
    }
  }
  const descriptor = await inspectProjectDurableSnapshot({
    rootDocId: payload.header.rootDocId,
    documents: args.readDocuments(),
    collaborationUpdate: payload.collabUpdateB64 ? decodeBase64(payload.collabUpdateB64) : null,
    generationId: payload.header.collaborationGeneration?.id ?? null,
    assetManifest: payload.header.assetsManifest ?? null,
    fullFileText: args.text,
  });
  if (descriptor.diagnostics.length > 0) throw projectProtectionError(descriptor.diagnostics[0]!, `[${descriptor.diagnostics[0]}] Project integrity verification failed.`);
  return descriptor;
}
