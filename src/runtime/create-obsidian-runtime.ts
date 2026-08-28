import type { DocumentId, DocumentRecord, KmindApp, NodeRefResolver } from "@kmind/app";
import {
  KMIND_APP_MESSAGES,
  createDocumentReplaceImportFeature,
  createDocumentSvgPackageExportFeature,
  createKmindApp,
  createNodeRefResolverForApp,
  createPublicAppCapabilities,
  parseKmindzProjectV3FromSvgText,
  registerFeatures,
  resolveThemePreset,
} from "@kmind/app";
import { createHostSyncedDocumentThemeState, createDocument, createKmindId, DefaultIdGenerator, upgradeLegacyDocumentThemeStateToHostSynced } from "@kmind/core";
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

export type ObsidianRuntime = {
  app: KmindApp;
  nodeRefResolver: NodeRefResolver;
  i18n: ReturnType<typeof createI18n>;
  rootDocId: DocumentId;
  preview: KmindPreviewBridge;
  dispose: () => void;
};

function deepClone<T>(value: T): T {
  const clone = (globalThis as unknown as { structuredClone?: ((v: unknown) => unknown) | undefined }).structuredClone;
  if (typeof clone === "function") return clone(value) as T;
  return JSON.parse(JSON.stringify(value)) as T;
}

function createSlateThemeState() {
  const slatePreset = resolveThemePreset("kmind-material-3-slate");
  return slatePreset
    ? createHostSyncedDocumentThemeState({ source: "inline", value: deepClone(slatePreset.theme) })
    : null;
}

export async function createObsidianRuntime(args: { app: App; file: TFile }): Promise<ObsidianRuntime> {
  const { host, preview } = createObsidianHostAdapter({ app: args.app, file: args.file });
  const mergedMessages = mergeMessagesByLocale(KMIND_APP_MESSAGES, KMIND_REACT_MESSAGES, KMIND_OBSIDIAN_UI_MESSAGES);
  const i18n = createI18n({
    locale: resolveObsidianLocale(),
    fallbackLocale: "zh-CN",
    messagesByLocale: mergedMessages,
  });

  await ensureKmindZenViewModesDefaultsLoaded(args.app);

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

  const existingText = await args.app.vault.read(args.file).catch(() => "");
  const existingPayload = existingText ? parseKmindzProjectV3FromSvgText(existingText) : null;
  const now = Date.now();
  if (existingText.trim().length > 0 && !existingPayload) {
    throw new Error("Invalid kmindz project file: missing/invalid v3 payload.");
  }
  const rootDocId: DocumentId = (existingPayload?.header.rootDocId ?? createKmindId("doc", { now })).trim() as DocumentId;

  const existing = await host.ports.documents.get(rootDocId);
  if (!existing) {
    const title = args.file.basename.trim() || "KMind";
    const themeState = createSlateThemeState();

    const record: DocumentRecord = {
      id: rootDocId,
      title,
      doc: (() => {
        const baseDoc = createDocument(new DefaultIdGenerator(), { rootText: title || "Root" });
        return themeState ? { ...baseDoc, theme: themeState } : baseDoc;
      })(),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    await host.ports.documents.put(record);
  } else {
    const ensured = (() => {
      const currentTheme = existing.doc?.theme;
      if (!currentTheme?.defaultTheme) {
        const themeState = createSlateThemeState();
        if (!themeState) return existing;
        return { ...existing, doc: { ...existing.doc, theme: themeState } };
      }
      const nextTheme = upgradeLegacyDocumentThemeStateToHostSynced(currentTheme);
      if (nextTheme === currentTheme) return existing;
      return { ...existing, doc: { ...existing.doc, theme: nextTheme } };
    })();
    await host.ports.documents.put({ ...ensured, lastOpenedAt: now });
  }

  const disposeFeatures = await registerFeatures(app, [
    ...commonFeaturePreset({ rootDocId }),
    createDocumentSvgPackageExportFeature(),
    createDocumentReplaceImportFeature({
      checkpointBeforeImport: true,
      confirmMessage: ({ i18n }: { i18n: { t: (key: string) => string } }) => i18n.t("obsidian.import.confirm.replace"),
    }),
    createObsidianFileSafetyFeature({ obsidianApp: args.app, file: args.file }),
  ]);
  await app.dispatch("document.switch", { id: rootDocId });

  return {
    app,
    nodeRefResolver,
    i18n,
    rootDocId,
    preview,
    dispose: () => {
      try {
        preview.setExporter(null);
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
