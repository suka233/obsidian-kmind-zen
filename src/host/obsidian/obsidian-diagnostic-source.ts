import { DiagnosticSendError, type DiagnosticSource } from "@kmind/app";
import type { App, TFile } from "obsidian";

export function createObsidianDiagnosticSource(app: App, file: TFile): DiagnosticSource {
  const path = file.path;
  return async (maxBytes, cancellation) => {
    const check = () => {
      if (cancellation.cancelled) throw new DiagnosticSendError("cancelled");
      if (file.path !== path || app.vault.getAbstractFileByPath(path) !== file) throw new DiagnosticSendError("source-changed");
    };
    try {
      check();
      const before = await app.vault.adapter.stat(path); check();
      if (!before || before.type !== "file") throw new DiagnosticSendError("source-unavailable");
      if (before.size > maxBytes) throw new DiagnosticSendError("attachment-too-large");
      const bytes = new Uint8Array(await app.vault.adapter.readBinary(path)); check();
      const after = await app.vault.adapter.stat(path); check();
      if (!after || after.type !== "file" || before.size !== after.size || before.mtime !== after.mtime || before.ctime !== after.ctime || bytes.length !== after.size) throw new DiagnosticSendError("source-changed");
      return bytes;
    } catch (error) { throw error instanceof DiagnosticSendError ? error : new DiagnosticSendError("source-unavailable"); }
  };
}
