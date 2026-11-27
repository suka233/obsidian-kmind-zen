import type { App, TFile } from "obsidian";
import {
  PROJECT_RECOVERY_INPUT_LIMITS,
  ProjectRecoveryError,
  inspectProjectRecoverySource,
  inspectCompleteSessionPackage,
  parseKmindzProjectV3FromSvgText,
  parseProjectSaveTransaction,
  readKmindzProjectIdentityFromSvgText,
  sha256HexText,
  prepareProjectRecoveryEvidence,
  chooseProjectRecoveryDestination,
  deliverProjectRecoveryEvidence,
  type FilesPort,
  type ProjectRecoveryInspectionSession,
  type ProjectRecoveryPort,
  type ProjectRecoverySourceReader,
} from "@kmind/app";
import { parseObsidianSafetyCopyFileName, resolveObsidianSafetyDirectory, resolveObsidianRetryArchiveDirectory } from "./obsidian-safe-project-write";
import { listObsidianSafetySourcePaths } from "./obsidian-safety-rename-links";

/** A project id usable as one directory name under `.kmind-zen/projects`. */
function isSafeProjectDirectoryName(id: string): boolean {
  return id !== "." && id !== ".." && !/[\\/\u0000]/u.test(id);
}

/** An image a JSON snapshot names: its content hash and extension, safe as a file name. */
function storedAssetFileName(asset: { contentHash: string; ext: string }): string | null {
  return /^[0-9a-f]{64}$/u.test(asset.contentHash) && /^[a-z0-9]{1,16}$/iu.test(asset.ext) ? `${asset.contentHash}.${asset.ext}` : null;
}

export type ObsidianRecoverySourceFile = { name: string; bytes: Uint8Array };

/**
 * The format of an external recovery source by its file name, or null when the file is none: a `.json` is a
 * JSON history snapshot (`.kmindz-docs.json`, also when renamed; the inspection decides). A history
 * thumbnail (`.preview.svg`, next to the checkpoints) or any other `.svg` is no source.
 */
export function obsidianRecoverySourceFormat(fileName: string): "package" | "yjs" | "documents" | null {
  const lower = String(fileName).split(/[\\/]/u).at(-1)!.toLowerCase();
  if (lower.endsWith(".kmindz.svg") || lower.endsWith(".kmindz")) return "package";
  if (lower.endsWith(".yjs")) return "yjs";
  if (lower.endsWith(".json")) return "documents";
  return null;
}

/**
 * Reads disk evidence without loading or updating the active project store. The project is
 * JSON-canonical: inspections judge the documents side, and rebuilt copies contain JSON only.
 *
 * The project's history is found by the project id the current file names (phase-34.16): the full
 * header, else the header's identity alone (a truncated file, a header that lost its root document),
 * else the one project the save transactions this file left name. JSON history snapshots
 * (`.kmindz-docs.json`) are listed with their images from the project's asset directory.
 * `openSourceFile` picks an external source (the production view passes a native dialog that starts in
 * the vault's `.kmind-zen/projects` and shows hidden files); by default `files.openFile`.
 */
export function createObsidianProjectRecovery(args: {
  app: App;
  file: TFile;
  files: FilesPort;
  openSourceFile?: (() => Promise<ObsidianRecoverySourceFile | null>) | undefined;
}): ProjectRecoveryPort {
  const vault = args.app.vault;
  const readers = new Map<string, ProjectRecoverySourceReader>();
  const ids = new Map<string, string>();
  let nonce = 0;
  let revision = 0;
  let exporting = false;
  let sourceWarningCount = 0;
  let projectIdentityKnown = true;
  let external: ProjectRecoverySourceReader | null = null;
  let active: { id: string; session: ProjectRecoveryInspectionSession } | null = null;
  const fail = () => new ProjectRecoveryError({ code: "source-read-failed", stage: "read" });
  const invalidate = () => { revision += 1; active?.session.dispose(); active = null; return revision; };
  const requireSession = (id: string) => {
    if (!active || active.id !== id) throw new ProjectRecoveryError({ code: "session-disposed", stage: "materialization" });
    return active.session;
  };
  const assertCurrent = (token: number) => {
    if (token !== revision) throw new ProjectRecoveryError({ code: "session-disposed", stage: "delivery" });
  };
  const read = async (path: string) => {
    const stat = await vault.adapter.stat(path);
    if (!stat || stat.type !== "file") throw fail();
    if (stat.size > PROJECT_RECOVERY_INPUT_LIMITS.sourceFileBytes) {
      throw new ProjectRecoveryError({ code: "source-too-large", stage: "read" });
    }
    return new Uint8Array(await vault.adapter.readBinary(path));
  };
  const add = (path: string, kind: ProjectRecoverySourceReader["kind"], format: ProjectRecoverySourceReader["format"], guardedRead?: () => Promise<Uint8Array>, displayName?: string, extra?: Pick<ProjectRecoverySourceReader, "readStoredAsset">) => {
    let id = ids.get(path);
    if (!id) { id = `obsidian-recovery-${++nonce}`; ids.set(path, id); }
    readers.set(id, { sourceId: id, kind, format, displayName: displayName ?? path.split("/").at(-1)!, read: guardedRead ?? (() => read(path)), ...extra });
  };
  /** Images of a JSON snapshot of `projectId`, from that project's asset directory; null when absent. */
  const storedAssetReader = (projectId: string): NonNullable<ProjectRecoverySourceReader["readStoredAsset"]> => async (asset) => {
    const name = storedAssetFileName(asset);
    if (!name) return null;
    const path = `.kmind-zen/projects/${projectId}/assets/${name}`;
    const stat = await vault.adapter.stat(path);
    if (!stat) return null;
    if (stat.type !== "file") throw fail();
    return new Uint8Array(await vault.adapter.readBinary(path));
  };
  /**
   * The project the save transactions of this file name (only when its header cannot be read): one project id
   * across all of them, else none. The same path can have held another project before (a file deleted and a new
   * one created under its name); transactions of different projects leave the identity unknown.
   */
  const identityFromSafetyTransactions = async (originPaths: readonly string[]): Promise<string | null> => {
    const projectIds = new Set<string>();
    for (const originPath of originPaths) {
      for (const directory of [await resolveObsidianSafetyDirectory(originPath), await resolveObsidianRetryArchiveDirectory(originPath)]) {
        if (!await vault.adapter.exists(directory)) continue;
        for (const folder of (await vault.adapter.list(directory)).folders) {
          const journalPath = `${folder}/transaction.json`;
          const stat = await vault.adapter.stat(journalPath);
          if (!stat || stat.type !== "file" || stat.size > 4096) continue;
          let transaction;
          try {
            transaction = parseProjectSaveTransaction(new TextDecoder("utf-8", { fatal: true }).decode(await read(journalPath)));
          } catch { continue; }
          if (transaction.targetKey === originPath && transaction.projectId) projectIds.add(transaction.projectId);
        }
      }
    }
    return projectIds.size === 1 ? [...projectIds][0]! : null;
  };
  const listSources: ProjectRecoveryPort["listSources"] = async () => {
    invalidate();
    sourceWarningCount = 0;
    readers.clear();
    add(args.file.path, "current-package", "package");
    // Recovery must remain available precisely when the canonical source fails.
    // Its registered reader still exposes the read/parse diagnostic on inspection.
    const enumerate = async (operation: () => Promise<void>) => {
      try { await operation(); } catch { sourceWarningCount++; }
    };
    const currentText = await read(args.file.path).then(bytes => new TextDecoder().decode(bytes)).catch(() => null);
    let originPaths = [args.file.path];
    await enumerate(async () => { originPaths = await listObsidianSafetySourcePaths(args.app, args.file.path); });
    // The project this file names itself: it also decides which crash copies and transactions are this file's.
    const headerRoot: string | null = currentText === null ? null
      : parseKmindzProjectV3FromSvgText(currentText)?.header.rootDocId ?? readKmindzProjectIdentityFromSvgText(currentText);
    // Where the history is: the file's own project, else the one project its save transactions name. The
    // transactions only locate the history; they never decide which safety copies belong to this file.
    let root = headerRoot;
    if (!root) await enumerate(async () => { root = await identityFromSafetyTransactions(originPaths); });
    // Project-scoped history cannot be enumerated without an identity: the view says so and offers the
    // external source picker.
    projectIdentityKnown = Boolean(root);
    if (!root) sourceWarningCount++;
    const safeRoot = root !== null && isSafeProjectDirectoryName(root);
    if (root && !safeRoot) sourceWarningCount++;
    if (safeRoot) {
      for (const kind of ["checkpoints", "conflicts"] as const) {
        await enumerate(async () => {
        const dir = `.kmind-zen/projects/${root}/history/${kind}`;
        if (!await vault.adapter.exists(dir)) return;
        const listing = await vault.adapter.list(dir);
        for (const path of listing.files.sort().reverse()) {
          await enumerate(async () => {
          if (!path.startsWith(`${dir}/`) || path.slice(dir.length + 1).includes("/") || path.includes("\\")) throw fail();
          if (path.endsWith(".kmindz.svg")) add(path, "package-checkpoint", "package");
          else if (path.endsWith(".yjs")) add(path, kind === "conflicts" ? "conflict-yjs" : "yjs-history", "yjs");
          else if (path.endsWith(".kmindz-docs.json")) add(path, "documents-history", "documents", undefined, undefined, { readStoredAsset: storedAssetReader(root!) });
          });
        }
        });
      }
    }
    for (const originPath of originPaths) {
    for (const safetyDirectory of [await resolveObsidianSafetyDirectory(originPath), await resolveObsidianRetryArchiveDirectory(originPath)]) {
    await enumerate(async () => {
    if (await vault.adapter.exists(safetyDirectory)) {
      const listing = await vault.adapter.list(safetyDirectory);
      // Crash copies (phase-25.8): complete candidates named by their SHA-256.
      for (const path of listing.files) {
        const copy = path.startsWith(`${safetyDirectory}/`) ? parseObsidianSafetyCopyFileName(path.slice(safetyDirectory.length + 1)) : null;
        if (!copy) continue;
        const label = `${copy.attemptId}.candidate.kmindz`;
        add(path, "package-checkpoint", "package", async () => {
          const bytes = await read(path);
          let text: string;
          try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw fail(); }
          const candidate = parseKmindzProjectV3FromSvgText(text);
          if (!candidate || (headerRoot && candidate.header.rootDocId !== headerRoot) || await sha256HexText(text) !== copy.candidateFingerprint) throw fail();
          return bytes;
        }, originPath === args.file.path ? label : `${originPath.split("/").at(-1)!.slice(-100)} · ${label}`);
      }
      for (const directory of listing.folders) {
        await enumerate(async () => {
        const transactionId = directory.slice(safetyDirectory.length + 1);
        if (!directory.startsWith(`${safetyDirectory}/`) || !/^[a-zA-Z0-9_-]+$/u.test(transactionId)) throw fail();
        for (const entry of ["source", "candidate"] as const) {
        const path = `${directory}/${entry}.kmindz.svg`;
        if (!await vault.adapter.exists(path)) continue;
        add(path, "package-checkpoint", "package", async () => {
          const journalPath = `${directory}/transaction.json`;
          const stat = await vault.adapter.stat(journalPath);
          if (!stat || stat.type !== "file" || stat.size > 4096) throw fail();
          let transaction;
          try {
            transaction = parseProjectSaveTransaction(new TextDecoder("utf-8", { fatal: true }).decode(await read(journalPath)));
          } catch { throw fail(); }
          if (transaction.transactionId !== transactionId || transaction.targetKey !== originPath) throw fail();
          const bytes = await read(path);
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          const source = parseKmindzProjectV3FromSvgText(text);
          if (source?.header.rootDocId !== transaction.projectId
            || (headerRoot && transaction.projectId !== headerRoot)
            || await sha256HexText(text) !== (entry === "source" ? transaction.sourceFingerprint : transaction.candidateFingerprint)) throw fail();
          return bytes;
        }, originPath === args.file.path ? `${transactionId}.${entry}.kmindz.svg` : `${originPath.split("/").at(-1)!.slice(-100)} · ${transactionId}.${entry}.kmindz.svg`);
        }
        });
      }
    }
    });
    }
    }
    if (external) readers.set(external.sourceId, external);
    return [...readers.values()].map(({ read: _, ...view }) => ({ ...view, modifiedAt: view.modifiedAt ?? null }));
  };
  const port: ProjectRecoveryPort = {
    listSources,
    getSourceWarningCount: () => sourceWarningCount,
    isProjectIdentityKnown: () => projectIdentityKnown,
    async exportEvidence(input) {
      if (exporting) throw new ProjectRecoveryError({ code: "writer-failed", stage: "delivery" });
      const source = readers.get(input.sourceId);
      if (!source) throw fail();
      const token = revision;
      const originPath = args.file.path;
      const session = input.candidate ? requireSession(input.candidate.inspectionId) : null;
      const assertOwner = () => {
        assertCurrent(token);
        if (args.file.path !== originPath) throw new ProjectRecoveryError({ code: "source-changed-during-scan", stage: "stability" });
      };
      exporting = true;
      try {
        const kind = input.candidate ? (input.format === "markdown" ? "readable-markdown" : "readable-content") : "original-evidence";
        const destination = await chooseProjectRecoveryDestination(args.files,
          `${kind}-${crypto.randomUUID()}.${kind === "original-evidence" ? "zip" : kind === "readable-markdown" ? "md" : "json"}`,
          kind === "original-evidence" ? "application/zip" : kind === "readable-markdown" ? "text/markdown" : "application/json");
        const prepared = await prepareProjectRecoveryEvidence({ source, session,
          ...(input.format ? { format: input.format } : {}), ...(input.locale ? { locale: input.locale } : {}),
          ...(input.candidate ? { candidateId: input.candidate.candidateId } : {}), assertSessionCurrent: assertOwner });
        await deliverProjectRecoveryEvidence({ destination, bytes: prepared.bytes, assertSourceUnchanged: prepared.assertSourceUnchanged });
        return { fileName: destination.fileName, location: destination.location, kind: prepared.kind, verification: "writer-readback-verified" as const };
      } finally { exporting = false; }
    },
    async exportSessionPackage({ bytes }) {
      if (exporting) throw new ProjectRecoveryError({ code: "writer-failed", stage: "delivery" });
      const token = invalidate();
      const inspected = await inspectCompleteSessionPackage(bytes, { documentsCanonical: true });
      if (token !== revision) { inspected.session.dispose(); assertCurrent(token); }
      const id = `obsidian-unsaved-${++nonce}`;
      active = { id, session: inspected.session };
      try { return await port.exportCandidate({ inspectionId: id, candidateId: inspected.candidateId }); }
      finally { port.releaseInspection({ inspectionId: id }); }
    },
    async selectExternalSource() {
      const token = invalidate();
      const selected = args.openSourceFile
        ? await args.openSourceFile()
        : await args.files.openFile({ accept: [".kmindz", ".kmindz.svg", ".yjs", ".json"] });
      if (token !== revision || !selected) return null;
      const name = selected.name.split(/[\\/]/u).at(-1)!;
      const format = obsidianRecoverySourceFormat(name);
      if (!format) throw new ProjectRecoveryError({ code: "unsupported-source", stage: "read" });
      if (selected.bytes.byteLength > PROJECT_RECOVERY_INPUT_LIMITS.sourceFileBytes) throw new ProjectRecoveryError({ code: "source-too-large", stage: "read" });
      const bytes = new Uint8Array(selected.bytes);
      if (external) readers.delete(external.sourceId);
      // A snapshot's images are in the asset directory of the project it names (verified by hash on use).
      const snapshotProject = format === "documents" ? readSnapshotProjectId(bytes) : null;
      external = {
        sourceId: `obsidian-external-${++nonce}`, displayName: name, format,
        kind: format === "package" ? "external-package" : format === "yjs" ? "external-yjs" : "external-documents",
        read: async () => bytes.slice(),
        ...(snapshotProject ? { readStoredAsset: storedAssetReader(snapshotProject) } : {}),
      };
      const { read: _, ...view } = external;
      readers.set(external.sourceId, external);
      return { ...view, modifiedAt: view.modifiedAt ?? null };
    },
    async inspectSource({ sourceId }) {
      const token = invalidate();
      const reader = readers.get(sourceId);
      if (!reader) return { ok: false, rejection: fail().rejection };
      const result = await inspectProjectRecoverySource({ source: reader, documentsCanonical: true });
      if (token !== revision) {
        if (result.ok) result.session.dispose();
        return { ok: false, rejection: { schemaVersion: 1, code: "session-disposed", stage: "materialization" } };
      }
      if (!result.ok) return result;
      active = { id: `obsidian-inspection-${++nonce}`, session: result.session };
      return { ok: true, inspection: { inspectionId: active.id, source: result.session.source, candidates: result.session.candidates } };
    },
    async readCandidate({ inspectionId, candidateId }) { return requireSession(inspectionId).readMaterialization(candidateId); },
    async exportCandidate({ inspectionId, candidateId }) {
      if (exporting) throw new ProjectRecoveryError({ code: "writer-failed", stage: "delivery" });
      const session = requireSession(inspectionId);
      const token = revision;
      const originPath = args.file.path;
      exporting = true;
      try {
        const destination = await chooseProjectRecoveryDestination(args.files, `recovered-${Date.now()}.kmindz`, "image/svg+xml");
        assertCurrent(token);
        if (args.file.path !== originPath) throw fail();
        const delivery = await session.deliverRecoveredCopy({
          candidateId, at: Date.now(), writer: { createNew: async output => {
            assertCurrent(token);
            if (args.file.path !== originPath) throw fail();
            return destination.writer.createNew(output);
          } },
        });
        assertCurrent(token);
        if (args.file.path !== originPath) throw fail();
        return { delivery: { ...delivery, fileName: destination.fileName }, destination: "user-selected", location: destination.location };
      } finally { exporting = false; }
    },

    releaseInspection({ inspectionId }) { if (active?.id === inspectionId) invalidate(); },
    clearExternalSource() { invalidate(); if (external) readers.delete(external.sourceId); external = null; },
  };
  return port;
}

/** The project id a JSON history snapshot names, when it is one with a usable id; the inspection checks the rest. */
function readSnapshotProjectId(bytes: Uint8Array): string | null {
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { rootDocId?: unknown } | null;
    const id = typeof parsed?.rootDocId === "string" ? parsed.rootDocId.trim() : "";
    return id && isSafeProjectDirectoryName(id) ? id : null;
  } catch {
    return null;
  }
}
