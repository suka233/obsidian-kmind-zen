import { DiagnosticSendError, type DiagnosticExporter, type FilesPort } from "@kmind/app";

/** Uses the host's create-new export port, never the original file's writer. */
export function createObsidianDiagnosticExporter(files: Pick<FilesPort, "downloadFile">): DiagnosticExporter {
  return async ({ name, bytes, cancellation }) => {
    if (cancellation.cancelled) throw new DiagnosticSendError("cancelled");
    await files.downloadFile({ name, bytes, mimeType: "application/zip" });
    return "saved";
  };
}
