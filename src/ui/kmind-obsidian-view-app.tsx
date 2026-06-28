import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type {
  KmindAppSnapshot,
  MindMapCanvasPort,
  MindMapExportPngArgs,
  MindMapExportSvgArgs,
  ThemeCatalogItem,
} from "@kmind/app";
import {
  THEME_PRESETS_APP,
  createOfficialThemeCatalogItems,
  listLocalThemeCatalogItems,
  resolveEffectiveKeymap,
  resolveKeymapMatch,
  resolveProjectBackgroundColorFromDoc,
} from "@kmind/app";
import {
  KMIND_WORKSPACE_ALL_VIEW_MODES,
  KmindOutlineWorkspace,
  type KmindWorkspaceMapChromeContext,
} from "@kmind/app-react";
import {
  I18nProvider,
  KMIND_PERFORMANCE_CONFIG,
  MindMapCanvas,
  createMindMapSharedResources,
  isNodeLike,
  isTypingTarget,
  resolveMindMapEditorPerformanceOptions,
  resolveOwnerWindow,
  useWorkspacePresentation,
  type MindMapCanvasApi,
  type MindMapCameraState,
  type MindMapCrossPaneDragBridge,
  type MindMapEditorPerformanceOptions,
  type MindMapEditorSelection,
  type MindMapMinimapModel,
  type MindMapPremiumFeatureKey,
} from "@kmind/editor-react";
import { Notice, type App, type TFile } from "obsidian";

import { createObsidianUiI18n, resolveObsidianLocale } from "../i18n/ui-i18n";
import { createObsidianRuntime, type ObsidianRuntime } from "../runtime/create-obsidian-runtime";
import { clearActiveObsidianKmindRuntime, setActiveObsidianKmindRuntime } from "../runtime/active-runtime";
import { createObsidianAppCapabilities } from "../runtime/obsidian-app-capabilities";
import { kmindZenObsidianLicenseStore } from "../runtime/license/license-store";
import { kmindZenObsidianKeymapOverridesStore } from "../runtime/keymap-overrides-store";
import { kmindZenViewModesDefaultsStore } from "../runtime/view-modes-defaults-store";
import { getObsidianThemeLibraryStoragePort } from "../runtime/theme-library-storage";
import { ObsidianFloatingToolbar } from "./obsidian-floating-toolbar";
import { openKmindZenObsidianUpdateDialog } from "./obsidian-update-dialog-host";

const KMIND_OBSIDIAN_AVAILABLE_WORKSPACE_VIEW_MODES = KMIND_WORKSPACE_ALL_VIEW_MODES;

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

function resolveCanvasPort(args: { canvasApiRef: React.MutableRefObject<MindMapCanvasApi | null> }): MindMapCanvasPort {
  return {
    zoomIn: () => args.canvasApiRef.current?.zoomIn(),
    zoomOut: () => args.canvasApiRef.current?.zoomOut(),
    zoomTo: (zoom: number) => args.canvasApiRef.current?.zoomTo(zoom),
    panTo: (pos: { x: number; y: number }) => args.canvasApiRef.current?.panTo(pos),
    fitView: () => args.canvasApiRef.current?.fitView(),
    focus: () => args.canvasApiRef.current?.focus(),
    selectNode: (nodeId: string) => args.canvasApiRef.current?.selectNode(nodeId),
    selectSummary: (summaryId: string) => args.canvasApiRef.current?.selectSummary(summaryId),
    deleteSelection: () => args.canvasApiRef.current?.deleteSelection?.(),
    addParent: () => args.canvasApiRef.current?.addParent?.(),
    moveSelectedNodes: (direction: "up" | "down") => args.canvasApiRef.current?.moveSelectedNodes?.(direction),
    setSelectedNodeCollapsed: (collapsed: boolean) => args.canvasApiRef.current?.setSelectedNodeCollapsed?.(collapsed),
    startEditNode: (nodeId: string) => args.canvasApiRef.current?.startEditNode?.(nodeId),
    openNodeMetaPopover: (args2) => args.canvasApiRef.current?.openNodeMetaPopover?.(args2),
    createRootAt: (pos: { x: number; y: number }) => args.canvasApiRef.current?.createRootAt?.(pos),
    createSummary: () => args.canvasApiRef.current?.createSummary(),
    startRelation: () => args.canvasApiRef.current?.startRelation(),
    exportSvg: async (args2?: MindMapExportSvgArgs) => {
      const api = args.canvasApiRef.current;
      if (!api) throw new Error("Canvas is not ready.");
      const blob = await api.exportSvg(args2);
      return blobToBytes(blob);
    },
    exportPng: async (args2?: MindMapExportPngArgs) => {
      const api = args.canvasApiRef.current;
      if (!api) throw new Error("Canvas is not ready.");
      const result = await api.exportPng(args2);
      return { bytes: await blobToBytes(result.blob), usedFallback: result.usedFallback };
    },
    exportPngSubtree: async (args2: { nodeId: string; mode?: MindMapExportPngArgs["mode"] | undefined; scale?: number | undefined; beautify?: MindMapExportPngArgs["beautify"] | undefined }) => {
      const api = args.canvasApiRef.current;
      if (!api?.exportPngSubtree) throw new Error("Subtree PNG export is not supported.");
      const result = await api.exportPngSubtree({ nodeId: args2.nodeId, mode: args2.mode, scale: args2.scale, beautify: args2.beautify });
      return { bytes: await blobToBytes(result.blob), usedFallback: result.usedFallback };
    },
  };
}

export function KmindObsidianViewApp(props: { hostApp: App; file: TFile | null }) {
  const uiI18n = useMemo(() => createObsidianUiI18n(), []);
  const uiT = useCallback(
    (key: string, params?: Record<string, unknown> | undefined) => uiI18n.t(key, params),
    [uiI18n],
  );

  const [licenseReady, setLicenseReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void kmindZenObsidianLicenseStore
      .ensureLoaded()
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        setLicenseReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const licenseSnapshot = useSyncExternalStore(
    kmindZenObsidianLicenseStore.subscribe,
    kmindZenObsidianLicenseStore.getSnapshot,
    kmindZenObsidianLicenseStore.getSnapshot,
  );

  const [runtime, setRuntime] = useState<ObsidianRuntime | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const presentation = useWorkspacePresentation();
  const runtimeRef = useRef<ObsidianRuntime | null>(null);
  const rootElRef = useRef<HTMLDivElement | null>(null);
  const canvasApiRef = useRef<MindMapCanvasApi | null>(null);
  const [camera, setCamera] = useState<MindMapCameraState | null>(null);
  const cameraRef = useRef<MindMapCameraState | null>(null);
  const [minimap, setMinimap] = useState<MindMapMinimapModel | null>(null);
  const [projectBackgroundOverride, setProjectBackgroundOverride] = useState<string | null>(null);
  const themeLibraryStorage = useMemo(() => getObsidianThemeLibraryStoragePort(props.hostApp), [props.hostApp]);
  const [themeLibraryVersion, setThemeLibraryVersion] = useState(0);
  const sharedResources = useMemo(
    () => (KMIND_PERFORMANCE_CONFIG.mindMap.sharedResources.enabled ? createMindMapSharedResources() : null),
    [],
  );
  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);
  useEffect(() => {
    if (!runtime) return;
    setActiveObsidianKmindRuntime(runtime);
    return () => clearActiveObsidianKmindRuntime(runtime);
  }, [runtime]);
  useEffect(() => {
    return () => sharedResources?.destroy();
  }, [sharedResources]);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  useEffect(() => {
    let cancelled = false;
    void themeLibraryStorage
      .hydrate()
      .then(() => {
        if (!cancelled) setThemeLibraryVersion((value) => value + 1);
      })
      .catch((error) => {
        console.error("[kmind-zen] failed to hydrate theme library:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [themeLibraryStorage]);
  const resolveThemeCatalog = useMemo(
    () => () => [
      ...createOfficialThemeCatalogItems(THEME_PRESETS_APP, { locale: resolveObsidianLocale(), fallbackLocale: "zh-CN" }),
      ...listLocalThemeCatalogItems(themeLibraryStorage, { locale: resolveObsidianLocale(), fallbackLocale: "zh-CN" }),
    ] satisfies ThemeCatalogItem[],
    [themeLibraryStorage, themeLibraryVersion],
  );

  useEffect(() => {
    if (licenseSnapshot.status !== "active") return;
    void kmindZenObsidianLicenseStore.bumpLastSeen();
  }, [licenseSnapshot.status]);

  const requestPremiumFeature = useCallback((feature: MindMapPremiumFeatureKey) => {
    const label = feature === "backlinks"
      ? uiT("obsidian.proFeature.backlinks")
      : feature === "formula"
        ? uiT("obsidian.proFeature.formula")
        : feature === "cloze"
          ? uiT("obsidian.proFeature.cloze")
          : feature === "comments"
            ? uiT("obsidian.proFeature.comments")
            : feature === "todo"
              ? uiT("obsidian.proFeature.todo")
              : "Pro feature";
    new Notice(uiT("obsidian.notice.proFeatureRequired", { feature: label }), 2800);
  }, [uiT]);

  useEffect(() => {
    let cancelled = false;
    const file = props.file;

    setRuntime(null);
    setInitError(null);
    runtimeRef.current?.dispose();
    runtimeRef.current = null;

    if (!file) return () => {};
    if (!licenseReady) return () => {};

    void (async () => {
      try {
        const created = await createObsidianRuntime({ app: props.hostApp, file });
        if (cancelled) {
          created.dispose();
          return;
        }
        setRuntime(created);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (cancelled) return;
        setInitError(message || uiT("obsidian.error.unknown"));
      }
    })();

    return () => {
      cancelled = true;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [props.file?.path, props.hostApp, licenseReady, uiT]);

  const snapshot = useSyncExternalStore(
    runtime?.app.subscribe ?? ((listener: () => void) => () => {}),
    runtime?.app.getSnapshot ?? (() => null),
    runtime?.app.getSnapshot ?? (() => null),
  );
  const hostDefaults = useSyncExternalStore(
    kmindZenViewModesDefaultsStore.subscribe,
    kmindZenViewModesDefaultsStore.getState,
    kmindZenViewModesDefaultsStore.getState,
  );
  const keymapOverrides = useSyncExternalStore(
    kmindZenObsidianKeymapOverridesStore.subscribe,
    kmindZenObsidianKeymapOverridesStore.getState,
    kmindZenObsidianKeymapOverridesStore.getState,
  );
  const snapshotRef = useRef<KmindAppSnapshot | null>(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!runtime) return;
    runtime.app.setCapabilities(createObsidianAppCapabilities(licenseSnapshot));
  }, [licenseSnapshot, runtime]);

  useEffect(() => {
    if (!runtime) return;
    const port = resolveCanvasPort({ canvasApiRef });
    runtime.app.setCanvasPort(port);
    return () => runtime.app.setCanvasPort(null);
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    runtime.preview.setExporter(async (docId) => {
      if (docId !== runtime?.app.getSnapshot().documents.activeId) return null;
      const api = canvasApiRef.current;
      if (!api) return null;
      const blob = await api.exportSvg({ mode: "fidelity", scope: "current" });
      return blob.text();
    });
    runtime.preview.setHistoryExporter(async () => {
      const api = canvasApiRef.current;
      if (!api) return null;
      const blob = await api.exportSvg({ mode: "portable", scope: "current" });
      return blob.text();
    });
    return () => {
      try {
        runtime.preview.setExporter(null);
        runtime.preview.setHistoryExporter(null);
      } catch {
        // ignore
      }
    };
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    const win = resolveOwnerWindow(rootElRef.current) ?? (typeof window !== "undefined" ? window : null);
    if (!win) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const rootEl = rootElRef.current;
      if (!rootEl) return;
      const target = event.target;
      if (isNodeLike(target) && !rootEl.contains(target)) return;
      if (isTypingTarget(event.target)) return;

      const current = snapshotRef.current;
      if (!current) return;
      const bindings = resolveEffectiveKeymap(current.registry.keymap, keymapOverrides, { hostId: runtime.app.host.id });
      const match = resolveKeymapMatch(bindings, event);
      if (!match) return;
      if (!runtime.app.isCommandEnabled(match.commandId, match.args)) return;

      event.preventDefault();
      event.stopPropagation();
      void runtime.app.dispatch(match.commandId, match.args).finally(() => runtime.app.focusCanvas());
    };

    win.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      win.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [keymapOverrides, runtime]);

  const core = snapshot?.editor?.activeCore ?? null;
  const activeCoreDocument = useSyncExternalStore(
    (listener) => core?.subscribe(listener) ?? (() => {}),
    () => core?.getState().document ?? null,
    () => core?.getState().document ?? null,
  );
  const isCanvasReady = Boolean(core && snapshot?.documents?.activeId && snapshot.documents.activeId === core.id);
  const activeNodeCount = useMemo(() => Object.keys(activeCoreDocument?.nodes ?? {}).length, [activeCoreDocument]);
  const performance = useMemo<MindMapEditorPerformanceOptions>(
    () => resolveMindMapEditorPerformanceOptions({
      activeNodeCount,
      config: KMIND_PERFORMANCE_CONFIG.mindMap,
    }),
    [activeNodeCount],
  );
  const readOnlyMode = Boolean(snapshot?.editor?.viewModes?.readOnly?.value);

  const openUpdateDialogManually = useCallback(() => {
    openKmindZenObsidianUpdateDialog(props.hostApp);
  }, [props.hostApp]);

  const projectBackgroundColor = useMemo(() => {
    if (!runtime) return null;
    if (!snapshot) return null;
    const rootDocId = snapshot.navigation.rootId ?? snapshot.documents.activeId;
    if (!rootDocId) return null;
    const record = snapshot.documents.items.find((item) => item.id === rootDocId) ?? null;
    return record ? resolveProjectBackgroundColorFromDoc(record.doc) : null;
  }, [runtime, snapshot]);
  const canvasBackgroundColor = projectBackgroundOverride ?? projectBackgroundColor;

  useEffect(() => {
    setProjectBackgroundOverride(null);
  }, [snapshot?.navigation.rootId]);

  if (initError) {
    return (
      <I18nProvider i18n={uiI18n}>
        <div style={{ padding: 16, fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{uiT("obsidian.init.failed.title")}</div>
          <div style={{ whiteSpace: "pre-wrap", color: "#b91c1c" }}>{initError}</div>
          <div style={{ marginTop: 12, color: "#64748b" }}>{uiT("obsidian.init.failed.hint")}</div>
        </div>
      </I18nProvider>
    );
  }

  if (props.file && !licenseReady) {
    return (
      <I18nProvider i18n={uiI18n}>
        <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#64748b" }}>
          {uiT("obsidian.init.loading.license")}
        </div>
      </I18nProvider>
    );
  }

  if (!runtime || !snapshot || !core || !isCanvasReady) {
    return (
      <I18nProvider i18n={uiI18n}>
        <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#64748b" }}>
          {uiT("obsidian.init.loading.runtime")}
        </div>
      </I18nProvider>
    );
  }

  const renderMap = (_visible = true, crossPaneDrag?: MindMapCrossPaneDragBridge) => (
    <MindMapCanvas
      canvasApiRef={canvasApiRef}
      className="kmind-zen-canvas"
      core={core}
      performance={performance}
      crossPaneDrag={crossPaneDrag}
      sharedResources={sharedResources ?? undefined}
      documentId={core.id}
      initialSelection="none"
      backlinksIndex={snapshot.editor.backlinksIndex}
      appUi={{
        snapshot,
        selectionToolbar: snapshot.registry.selectionToolbar,
        contextMenus: snapshot.registry.contextMenus,
        keymapOverrides,
        themeCatalog: resolveThemeCatalog,
        dispatchCommand: (commandId, args) => runtime.app.dispatch(commandId, args).finally(() => runtime.app.focusCanvas()),
        isCommandEnabled: (commandId, args) => runtime.app.isCommandEnabled(commandId, args),
      }}
      dialog={runtime.app.host.ports.dialog}
      clipboard={runtime.app.host.ports.clipboard}
      external={runtime.app.host.ports.external}
      storage={runtime.app.host.ports.storage}
      assetUrls={runtime.app.host.ports.assetUrls}
      layoutEngine={snapshot.editor.layoutEngine}
      layoutOptions={snapshot.editor.layoutOptions ?? undefined}
      nodeBodyLayout={snapshot.editor.nodeBodyLayout}
      canvasBackgroundColor={canvasBackgroundColor}
      canvasHeight="100%"
      editingLayoutMode="live-preview"
      dragGhostMode="rich"
      nodeChrome={{
        showNodeWidthResizeHandle: true,
        showAddChildButton: hostDefaults.showAddChildButton,
        showNodeMenuTrigger: hostDefaults.showNodeMenuTrigger,
      }}
      interaction={{
        canvasDragMode: hostDefaults.canvasDragMode,
        collapseToggleVisibility: presentation.isCompact ? "always" : "hover",
        blankDoubleClickAction: readOnlyMode ? "none" : "add-root",
        smartPaste: !readOnlyMode,
        showDetachedRootHint: false,
        readOnly: readOnlyMode,
        flowchartTools: { enabled: false },
      }}
      submap={{
        canGoBack: snapshot.navigation.path.length > 1,
        enterSubmap: (nodeId) => {
          void runtime.app.dispatch("submap.enter", { nodeId }).finally(() => runtime.app.focusCanvas());
        },
        backToParentMap: () => {
          void runtime.app.dispatch("submap.back").finally(() => runtime.app.focusCanvas());
        },
      }}
      onNodeAction={(action) => {
        if (readOnlyMode) return;
        if (action.type === "task.toggle") {
          void runtime.app.dispatch("node.task.toggleDone", { nodeId: action.nodeId }).finally(() => runtime.app.focusCanvas());
        }
        if (action.type === "node.width.set") {
          void runtime.app.dispatch("node.width.set", { nodeId: action.nodeId, width: action.width, mode: action.mode }).finally(() => runtime.app.focusCanvas());
        }
        if (action.type === "node.width.reset") {
          void runtime.app.dispatch("node.width.reset", { nodeId: action.nodeId, wrapWidth: action.wrapWidth }).finally(() => runtime.app.focusCanvas());
        }
        if (action.type === "notes.set") {
          void runtime.app.dispatch("node.notes.setText", { nodeId: action.nodeId, doc: action.doc, html: action.html }).finally(() => runtime.app.focusCanvas());
        }
        if (action.type === "notes.clear") {
          void runtime.app.dispatch("node.notes.clear", { nodeId: action.nodeId }).finally(() => runtime.app.focusCanvas());
        }
        if (action.type === "comments.add") {
          void runtime.app.dispatch("node.comments.add", { nodeId: action.nodeId, text: action.text, createdAt: action.createdAt }).finally(() => runtime.app.focusCanvas());
        }
        if (action.type === "comments.update") {
          void runtime.app.dispatch("node.comments.update", { nodeId: action.nodeId, commentId: action.commentId, text: action.text }).finally(() => runtime.app.focusCanvas());
        }
        if (action.type === "comments.remove") {
          void runtime.app.dispatch("node.comments.remove", { nodeId: action.nodeId, commentId: action.commentId }).finally(() => runtime.app.focusCanvas());
        }
        if (action.type === "comments.clear") {
          void runtime.app.dispatch("node.comments.clear", { nodeId: action.nodeId }).finally(() => runtime.app.focusCanvas());
        }
      }}
      onSelectionChange={(selection: MindMapEditorSelection) => {
        runtime.app.setSelection(selection);
      }}
      onCameraChange={(next) => {
        setCamera(next);
      }}
      onMinimapChange={(next) => {
        setMinimap(next);
      }}
      onOpenNodeRef={(ref) => {
        void runtime.app.dispatch("node.link.open", ref).finally(() => runtime.app.focusCanvas());
      }}
      premiumCapabilities={snapshot.capabilities.premium}
      onPremiumFeatureBlocked={requestPremiumFeature}
      resolveNodeRefTitle={({ docId, nodeId }) => {
        return runtime.nodeRefResolver.resolveNodeRefTitle({ docId, nodeId });
      }}
      resolveNodeRefExists={({ docId, nodeId }) => {
        return runtime.nodeRefResolver.resolveNodeRefExists({ docId, nodeId });
      }}
      nodeRefResolveStore={runtime.nodeRefResolver}
    />
  );

  const renderMapChrome = (context: KmindWorkspaceMapChromeContext) => (
    <ObsidianFloatingToolbar
      file={props.file!}
      app={runtime.app}
      preview={runtime.preview}
      camera={camera}
      hostApp={props.hostApp}
      minimap={minimap}
      snapshot={snapshot}
      onOpenUpdateDialog={openUpdateDialogManually}
      onProjectBackgroundDraftChange={setProjectBackgroundOverride}
      viewModeControl={context.viewModeControl}
    />
  );

  return (
    <I18nProvider i18n={runtime.i18n}>
      <div
        ref={rootElRef}
        onPointerDownCapture={() => setActiveObsidianKmindRuntime(runtime)}
        onPointerEnter={() => setActiveObsidianKmindRuntime(runtime)}
        style={{ position: "absolute", inset: 0 }}
      >
        <KmindOutlineWorkspace
          app={runtime.app}
          assetUrls={runtime.app.host.ports.assetUrls}
          core={core}
          nodeRefResolveStore={runtime.nodeRefResolver}
          onPremiumFeatureBlocked={requestPremiumFeature}
          onOpenNodeRef={(ref) => {
            void runtime.app.dispatch("node.link.open", ref).finally(() => runtime.app.focusCanvas());
          }}
          premiumCapabilities={snapshot.capabilities.premium}
          readOnly={readOnlyMode}
          renderMap={renderMap}
          renderMapChrome={renderMapChrome}
          availableViewModes={KMIND_OBSIDIAN_AVAILABLE_WORKSPACE_VIEW_MODES}
          performance={KMIND_PERFORMANCE_CONFIG.workspace}
          resolveNodeRefExists={({ docId, nodeId }) => {
            return runtime.nodeRefResolver.resolveNodeRefExists({ docId, nodeId });
          }}
          resolveNodeRefTitle={({ docId, nodeId }) => {
            return runtime.nodeRefResolver.resolveNodeRefTitle({ docId, nodeId });
          }}
          selectInCanvas={(target, options) => {
            if (target.type === "node") canvasApiRef.current?.selectNode(target.id, { reveal: options?.reveal === true });
            else canvasApiRef.current?.selectSummary(target.id, { reveal: options?.reveal === true });
          }}
          snapshot={snapshot}
        />
      </div>
    </I18nProvider>
  );
}
