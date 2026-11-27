import { registerObsidianQuitSave } from "./obsidian-quit-save";
import { observeDiagnosticOperation, annotateDiagnosticError } from "@kmind/app";
import type { DocumentId, KmindApp, NodeRefResolver } from "@kmind/app";
import {
  KMIND_APP_MESSAGES,
  assertKmindzProjectHeaderNotTooNew,
  createDevBuildFeature,
  createDocumentReplaceImportFeature,
  createDocumentSvgPackageExportFeature,
  createKmindApp,
  createNodeRefResolverForApp,
  parseKmindzProjectV3FromSvgText,
  registerFeatures,
  unsafeGetKmindAppInternal,
} from "@kmind/app";
import { createI18n, mergeMessagesByLocale } from "@kmind/i18n";
import { KMIND_REACT_MESSAGES } from "@kmind/editor-react";
import type { App, TFile } from "obsidian";

import { createObsidianHostAdapter, type KmindPreviewBridge } from "../host/obsidian/create-obsidian-host-adapter";
import { KMIND_OBSIDIAN_UI_MESSAGES } from "../i18n/messages";
import { resolveObsidianLocale } from "../i18n/ui-i18n";

import { commonFeaturePreset } from "./feature-presets";
import { createObsidianAppCapabilities } from "./obsidian-app-capabilities";
import { kmindZenObsidianLicenseStore } from "./license/license-store";
import { createObsidianFileSafetyFeature } from "./obsidian-file-safety-feature";
import { ensureKmindZenViewModesDefaultsLoaded } from "./view-modes-defaults-store";
import { acquireObsidianEditLease, type ObsidianEditLease } from "./obsidian-edit-lease";
import { registerObsidianSessionClose, waitForObsidianSessionClose } from "./obsidian-session-handoff";

export type ObsidianRuntime = {
  app: KmindApp;
  nodeRefResolver: NodeRefResolver;
  i18n: ReturnType<typeof createI18n>;
  rootDocId: DocumentId;
  preview: KmindPreviewBridge;
  dispose: () => void;
};

export async function createObsidianRuntime(args: { app: App; file: TFile }): Promise<ObsidianRuntime> {
  return observeDiagnosticOperation("initialization", () => createObservedObsidianRuntime(args));
}
async function createObservedObsidianRuntime(args: { app: App; file: TFile }): Promise<ObsidianRuntime> {
  await waitForObsidianSessionClose(args.app.vault, args.file);
  const editLease = await acquireObsidianEditLease(args.file);
  try {
    return await createLeasedObsidianRuntime(args, editLease);
  } catch (error) {
    // Nothing of this runtime was written; the next view may edit at once.
    editLease.release();
    throw error;
  }
}

async function createLeasedObsidianRuntime(args: { app: App; file: TFile }, editLease: ObsidianEditLease): Promise<ObsidianRuntime> {
  // The only read of the file while it opens (phase-25.9): the store loads this same text.
  const existingText = await observeDiagnosticOperation("read", () => args.app.vault.read(args.file));
  const existingPayload = existingText ? parseKmindzProjectV3FromSvgText(existingText) : null;
  if (!existingPayload) {
    // A file a newer version wrote asks to update (phase-34.24), shown in the error page's language.
    assertKmindzProjectHeaderNotTooNew(existingText ?? "");
    const error = new Error("Invalid kmindz project file: missing/invalid v3 payload."); annotateDiagnosticError(error, { stage: "container" }); throw error;
  }
  const rootDocId = existingPayload.header.rootDocId.trim() as DocumentId;
  if (!rootDocId) throw new Error("Invalid kmindz project file: missing root document ID.");

  const { host, preview, lifecycle } = createObsidianHostAdapter({ app: args.app, file: args.file, editLease, openingText: existingText });
  const mergedMessages = mergeMessagesByLocale(KMIND_APP_MESSAGES, KMIND_REACT_MESSAGES, KMIND_OBSIDIAN_UI_MESSAGES);
  const i18n = createI18n({
    locale: resolveObsidianLocale(),
    fallbackLocale: "zh-CN",
    messagesByLocale: mergedMessages,
  });

  await ensureKmindZenViewModesDefaultsLoaded(args.app);

  if (!await observeDiagnosticOperation("integrity", () => host.ports.documents.get(rootDocId), { containerVersion: 3 })) {
    throw new Error("Invalid kmindz project file: root document is missing. Keep the original file and use recovery inspection.");
  }

  const app = createKmindApp({
    host,
    i18n,
    capabilities: createObsidianAppCapabilities(kmindZenObsidianLicenseStore.getSnapshot()),
    runtimeInfo: {
      productName: "KMind Zen",
      host: host.id,
      appVersion: __KMIND_ZEN_APP_VERSION__,
      coreVersion: __KMIND_ZEN_CORE_VERSION__,
      websiteUrl: __KMIND_ZEN_WEBSITE_URL__,
    },
  });
  const nodeRefResolver = createNodeRefResolverForApp(app);

  let disposeFeatures: Awaited<ReturnType<typeof registerFeatures>> = () => {};
  try {
    disposeFeatures = await registerFeatures(app, [
      ...(__KMIND_ZEN_DEV_BUILD_ID__ ? [createDevBuildFeature(__KMIND_ZEN_DEV_BUILD_ID__)] : []),
      ...commonFeaturePreset({ rootDocId }),
      createDocumentSvgPackageExportFeature(),
      createDocumentReplaceImportFeature({
        checkpointBeforeImport: true,
        projectReplacement: "durable",
        confirmMessage: ({ i18n }: { i18n: { t: (key: string) => string } }) => i18n.t("obsidian.import.confirm.replace"),
      }),
      createObsidianFileSafetyFeature({ obsidianApp: args.app, file: args.file, editLease, prepareTakeover: lifecycle.prepareTakeover }),
    ]);
    await app.dispatch("document.switch", { id: rootDocId });
  } catch (error) {
    lifecycle.beginClose();
    for (const cleanup of [() => disposeFeatures("initialization-failed"), () => nodeRefResolver.dispose(), () => preview.setHistoryExporter(null)]) {
      try { cleanup(); } catch { /* Preserve the original failure while releasing remaining owners. */ }
    }
    throw error;
  }

  let disposed = false;
  const disposeQuit = registerObsidianQuitSave(args.app.workspace, app, lifecycle);
  return {
    app,
    nodeRefResolver,
    i18n,
    rootDocId,
    preview,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeQuit();
      lifecycle.beginClose();
      // Capture the registered autosave drain before feature teardown unregisters it.
      // Teardown synchronously enqueues any required disposal flush; the drain loops until stable.
      const pendingSaves = unsafeGetKmindAppInternal(app).waitForPendingProjectSaves();
      const closed = pendingSaves.then(() => lifecycle.whenWritesIdle());
      registerObsidianSessionClose(args.app.vault, args.file, closed);
      // The next view of this file edits only after this one's last save.
      editLease.release(closed);
      try {
        preview.setHistoryExporter(null);
      } catch {
        // ignore
      }
      try {
        nodeRefResolver.dispose();
      } catch {
        // ignore
      }
      try {
        disposeFeatures();
      } catch {
        // ignore
      }
    },
  };
}
