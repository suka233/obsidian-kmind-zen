import { useMemo } from "react";
import { apiVersion, Platform, type App, type TFile } from "obsidian";
import { collectOpenDiagnostic, diagnosticEnvironment } from "@kmind/app";
import { OpenDiagnosticPanel } from "@kmind/app-react";
import { resolveObsidianLocale } from "../i18n/ui-i18n";
import { createObsidianDiagnosticSource } from "../host/obsidian/obsidian-diagnostic-source";
import { createObsidianDiagnosticExporter } from "../host/obsidian/obsidian-diagnostic-export";
import { createObsidianFilesPort } from "../host/obsidian/obsidian-files";
export function ObsidianOpenDiagnostic(props: { app: App; file: TFile; error: Error }) {
  const diagnostic = useMemo(() => collectOpenDiagnostic({ host: "obsidian", surface: "project", error: props.error,
    build: __KMIND_ZEN_DIAGNOSTIC_BUILD__, environment: diagnosticEnvironment(globalThis.navigator?.userAgent ?? "", (globalThis as typeof globalThis & { process?: { versions?: { electron?: string; node?: string } } }).process?.versions),
      pluginVersion: __KMIND_ZEN_APP_VERSION__, coreVersion: __KMIND_ZEN_CORE_VERSION__, hostVersion: apiVersion,
    platform: Platform.isMobile ? "mobile" : "desktop" }), [props.error]);
  const readSource = useMemo(() => createObsidianDiagnosticSource(props.app, props.file), [props.app, props.file, props.file.path, props.error]);
  const exporter = useMemo(() => createObsidianDiagnosticExporter(createObsidianFilesPort({ app: props.app, baseFile: props.file })), [props.app, props.file, props.file.path, props.error]);
  const locale = resolveObsidianLocale();
  const exportHint = locale.startsWith("zh") ? "ZIP 会新建在这张导图所在的文件夹，可能随 Obsidian 库同步。请妥善保管，排查后自行清理。" : "A new ZIP is created in this map's folder and may sync with your Obsidian vault. Keep it private and remove it after investigation.";
  return <OpenDiagnosticPanel diagnostic={diagnostic} readSource={readSource} exporter={exporter} exportHint={exportHint} apiBase={__KMIND_ZEN_API_BASE__} locale={locale} />;
}
