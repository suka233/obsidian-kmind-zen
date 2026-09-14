import type { App, TFile } from "obsidian";
import {
  PROJECT_RECOVERY_INPUT_LIMITS,
  ProjectRecoveryError,
  inspectProjectRecoverySource,
  inspectCompleteSessionPackage,
  parseKmindzProjectV3FromSvgText,
  parseProjectSaveTransaction,
  sha256HexText,
  prepareProjectRecoveryEvidence,
  chooseProjectRecoveryDestination,
  deliverProjectRecoveryEvidence,
  type FilesPort,
  type ProjectRecoveryInspectionSession,
  type ProjectRecoveryPort,
  type ProjectRecoverySourceReader,
} from "@kmind/app";
import { resolveObsidianSafetyDirectory, resolveObsidianRetryArchiveDirectory } from "./obsidian-safe-project-write";
import { listObsidianSafetySourcePaths } from "./obsidian-safety-rename-links";

/** Reads disk evidence without loading or updating the active project store. */
export function createObsidianProjectRecovery(args: { app: App; file: TFile; files: FilesPort }): ProjectRecoveryPort {
  const vault = args.app.vault;
  const readers = new Map<string, ProjectRecoverySourceReader>();
  const ids = new Map<string, string>();
  let nonce = 0;
  let revision = 0;
  let exporting = false;
  let sourceWarningCount = 0;
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
  const add = (path: string, kind: ProjectRecoverySourceReader["kind"], format: "package" | "yjs", guardedRead?: () => Promise<Uint8Array>, displayName?: string) => {
    let id = ids.get(path);
    if (!id) { id = `obsidian-recovery-${++nonce}`; ids.set(path, id); }
    readers.set(id, { sourceId: id, kind, format, displayName: displayName ?? path.split("/").at(-1)!, read: guardedRead ?? (() => read(path)) });
  };
  const listSources: ProjectRecoveryPort["listSources"] = async () => {
    invalidate();
    sourceWarningCount = 0;
    readers.clear();
    add(args.file.path, "current-package", "package");
    // Recovery must remain available precisely when the canonical source fails.
    // Its registered reader still exposes the read/parse diagnostic on inspection.
    const payload = await read(args.file.path)
      .then(bytes => parseKmindzProjectV3FromSvgText(new TextDecoder().decode(bytes)))
      .catch(() => null);
    const root = payload?.header.rootDocId;
    if (!root) sourceWarningCount++; // Project-scoped history cannot be enumerated without an identity.
    const enumerate = async (operation: () => Promise<void>) => {
      try { await operation(); } catch { sourceWarningCount++; }
    };
    const safeRoot = root && root !== "." && root !== ".." && !/[\\/\u0000]/u.test(root);
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
          });
        }
        });
      }
    }
    let originPaths = [args.file.path];
    await enumerate(async () => { originPaths = await listObsidianSafetySourcePaths(args.app, args.file.path); });
    for (const originPath of originPaths) {
    for (const safetyDirectory of [await resolveObsidianSafetyDirectory(originPath), await resolveObsidianRetryArchiveDirectory(originPath)]) {
    await enumerate(async () => {
    if (await vault.adapter.exists(safetyDirectory)) {
      const listing = await vault.adapter.list(safetyDirectory);
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
            || (root && transaction.projectId !== root)
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
      const inspected = await inspectCompleteSessionPackage(bytes);
      if (token !== revision) { inspected.session.dispose(); assertCurrent(token); }
      const id = `obsidian-unsaved-${++nonce}`;
      active = { id, session: inspected.session };
      try { return await port.exportCandidate({ inspectionId: id, candidateId: inspected.candidateId }); }
      finally { port.releaseInspection({ inspectionId: id }); }
    },
    async selectExternalSource() {
      const token = invalidate();
      const selected = await args.files.openFile({ accept: [".kmindz", ".kmindz.svg", ".yjs"] });
      if (token !== revision || !selected) return null;
      const name = selected.name.split(/[\\/]/u).at(-1)!;
      const lower = name.toLowerCase();
      const format = lower.endsWith(".kmindz.svg") || lower.endsWith(".kmindz") ? "package" : lower.endsWith(".yjs") ? "yjs" : null;
      if (!format) throw fail();
      if (selected.bytes.byteLength > PROJECT_RECOVERY_INPUT_LIMITS.sourceFileBytes) throw new ProjectRecoveryError({ code: "source-too-large", stage: "read" });
      const bytes = new Uint8Array(selected.bytes);
      if (external) readers.delete(external.sourceId);
      external = { sourceId: `obsidian-external-${++nonce}`, displayName: name, format, kind: format === "package" ? "external-package" : "external-yjs", read: async () => bytes.slice() };
      const { read: _, ...view } = external;
      readers.set(external.sourceId, external);
      return { ...view, modifiedAt: view.modifiedAt ?? null };
    },
    async inspectSource({ sourceId }) {
      const token = invalidate();
      const reader = readers.get(sourceId);
      if (!reader) return { ok: false, rejection: fail().rejection };
      const result = await inspectProjectRecoverySource({ source: reader });
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
