import type { DocumentId, DocumentRecord, KmindzProjectSvgHeaderV3 } from "@kmind/app";
import { createZipStore, encodeBase64, encodeKmindzProjectV3IntoSvgText, resolveThemePreset } from "@kmind/app";
import { createHostSyncedDocumentThemeState, createDocument, createKmindId, DefaultIdGenerator } from "@kmind/core";

import { sha256Hex, sha256HexFromString } from "./hash";
import { buildPlaceholderPreviewSvg } from "./placeholder-preview-svg";

function deepClone<T>(value: T): T {
  const clone = (globalThis as unknown as { structuredClone?: ((v: unknown) => unknown) | undefined }).structuredClone;
  if (typeof clone === "function") return clone(value) as T;
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function createEmptyKmindzText(args: { title: string }): Promise<string> {
  const now = Date.now();
  const rootDocId = createKmindId("doc", { now }) as DocumentId;
  const title = String(args.title ?? "").trim() || "Untitled";
  const doc = (() => {
    const baseDoc = createDocument(new DefaultIdGenerator(), { rootText: title || "Root" });
    const slatePreset = resolveThemePreset("kmind-material-3-slate");
    if (!slatePreset) return baseDoc;
    const themeState = createHostSyncedDocumentThemeState({ source: "inline", value: deepClone(slatePreset.theme) });
    return { ...baseDoc, theme: themeState };
  })();

  const record: DocumentRecord = {
    id: rootDocId,
    title,
    doc,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };

  const encoder = new TextEncoder();
  const encodeUtf8 = (text: string) => encoder.encode(text);

  const docsManifest = {
    schemaVersion: 1,
    rootDocId,
    documents: [{ id: rootDocId, title, path: `docs/${rootDocId}.json` }],
  };
  const docsZipBytes = createZipStore([
    { path: "manifest.json", bytes: encodeUtf8(JSON.stringify(docsManifest)) },
    { path: `docs/${rootDocId}.json`, bytes: encodeUtf8(JSON.stringify(record.doc)) },
  ]);
  const docsZipB64 = encodeBase64(docsZipBytes);
  const docsHash = await sha256Hex(docsZipBytes);

  const contentRev = await sha256HexFromString(
    JSON.stringify({
      rootDocId,
      collab: null,
      docs: docsHash,
      assets: null,
    }),
  );

  const header: KmindzProjectSvgHeaderV3 = {
    format: "kmindz-project-svg",
    version: 3,
    mapKey: rootDocId,
    rootDocId,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    rev: contentRev,
    documentsMeta: {
      [rootDocId]: {
        id: rootDocId,
        title,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
      },
    },
    hashes: { docs: docsHash },
    host: { kind: "obsidian" },
  };

  const previewSvg = buildPlaceholderPreviewSvg({ title, subtitle: "KMind Zen (.kmindz)" });
  return encodeKmindzProjectV3IntoSvgText({ previewSvg, header, docsZipB64 });
}
