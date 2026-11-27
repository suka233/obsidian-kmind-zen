import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type {
  KeyCombo,
  KmindAppSnapshot,
  MindMapCanvasPort,
  MindMapExportLecturePdfArgs,
  MindMapExportLectureSvgArgs,
  MindMapExportPngArgs,
  MindMapExportSvgArgs,
  ThemeCatalogItem,
} from "@kmind/app";
import {
  THEME_PRESETS_APP,
  createOfficialThemeCatalogItems,
  describeLegacyMigrationRefusal,
  describeWhiteboardReadFailure,
  listLocalThemeCatalogItems,
  resolveEffectiveKeymap,
  resolveHostShortcutRoute,
  resolveProjectBackgroundColorFromDoc,
  saveNodeNotesImmediately,
  rethrowUnlessWhiteboardEditorUncommitted,
} from "@kmind/app";
import {
  KMIND_WORKSPACE_ALL_VIEW_MODES,
  KmindOutlineWorkspace,
  WorkspaceActivityStatus,
  useProjectWorkspaceNotices,
  type KmindWorkspaceMapChromeContext,
} from "@kmind/app-react";
import {
  I18nProvider,
  KMIND_PERFORMANCE_CONFIG,
  KmindHostSurfaceErrorBoundary,
  MindMapCanvas,
  WorkspaceTopChromeScope,
  createMindMapSharedResources,
  isNodeLike,
  isTypingKeyEvent,
  isWhiteboardEditorTarget,
  resolveHostWhiteboardProps,
  resolveMindMapEditorPerformanceOptions,
  resolveOwnerWindow,
  useOwnerWindow,
  useWhiteboardViewOnlyDevice,
  useWorkspacePresentation,
  type MindMapCanvasApi,
  type MindMapCameraState,
  type MindMapCrossPaneDragBridge,
  type MindMapEditorPerformanceOptions,
  type MindMapMinimapModel,
  type MindMapPremiumFeatureKey,
} from "@kmind/editor-react";
import { Notice, type App, type TFile } from "obsidian";

import { createObsidianUiI18n, resolveObsidianLocale } from "../i18n/ui-i18n";
import { createObsidianRuntime, type ObsidianRuntime } from "../runtime/create-obsidian-runtime";
import { ObsidianFailedProjectRecovery } from "./obsidian-failed-project-recovery";
import { ObsidianOpenDiagnostic } from "./obsidian-open-diagnostic";
import { createObsidianAppCapabilities } from "../runtime/obsidian-app-capabilities";
import { kmindZenObsidianLicenseStore } from "../runtime/license/license-store";
import { kmindZenObsidianKeymapOverridesStore } from "../runtime/keymap-overrides-store";
import { kmindZenViewModesDefaultsStore } from "../runtime/view-modes-defaults-store";
import { resolveObsidianClaimedCombos } from "../views/obsidian-key-claims";
import { getObsidianThemeLibraryStoragePort } from "../runtime/theme-library-storage";
import { ObsidianFloatingToolbar } from "./obsidian-floating-toolbar";
import { openKmindZenObsidianUpdateDialog } from "./obsidian-update-dialog-host";

const KMIND_OBSIDIAN_AVAILABLE_WORKSPACE_VIEW_MODES = KMIND_WORKSPACE_ALL_VIEW_MODES;

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * The canvas port answers `resolveWhiteboardArrowEndpointFallbacks` only while a canvas is mounted:
 * only the canvas knows where the arrow ends a deletion frees are drawn (decisions R29, R45).
 * Without one the method is absent and the app refuses such a deletion with its own explanation.
 */
function withMountedCanvasArrowEndpointFallbacks(
  port: MindMapCanvasPort,
  canvasApiRef: React.MutableRefObject<MindMapCanvasApi | null>,
): MindMapCanvasPort {
  return Object.defineProperty(port, "resolveWhiteboardArrowEndpointFallbacks", {
    enumerable: true,
    get() {
      const api = canvasApiRef.current;
      const resolve = api?.resolveWhiteboardArrowEndpointFallbacks;
      if (!api || !resolve) return undefined;
      return (input: Parameters<typeof resolve>[0]) => resolve.call(api, input);
    },
  });
}

function resolveCanvasPort(args: { canvasApiRef: React.MutableRefObject<MindMapCanvasApi | null> }): MindMapCanvasPort {
  return withMountedCanvasArrowEndpointFallbacks({
    zoomIn: () => args.canvasApiRef.current?.zoomIn(),
    zoomOut: () => args.canvasApiRef.current?.zoomOut(),
    zoomTo: (zoom: number) => args.canvasApiRef.current?.zoomTo(zoom),
    panTo: (pos: { x: number; y: number }) => args.canvasApiRef.current?.panTo(pos),
    fitView: () => args.canvasApiRef.current?.fitView(),
    zoomToSelection: () => args.canvasApiRef.current?.zoomToSelection(),
    canZoomToSelection: () => args.canvasApiRef.current?.canZoomToSelection() ?? false,
    getSelectedWhiteboardElementIds: () => args.canvasApiRef.current?.getSelectedWhiteboardElementIds?.() ?? [],
    focus: () => args.canvasApiRef.current?.focus(),
    selectNode: (nodeId: string) => args.canvasApiRef.current?.selectNode(nodeId),
    selectSummary: (summaryId: string) => args.canvasApiRef.current?.selectSummary(summaryId),
    deleteSelection: () => args.canvasApiRef.current?.deleteSelection?.(),
    addParent: () => args.canvasApiRef.current?.addParent?.(),
    moveSelectedNodes: (direction: "up" | "down") => args.canvasApiRef.current?.moveSelectedNodes?.(direction),
    getCollapsedNodeIds: () => args.canvasApiRef.current?.getCollapsedNodeIds() ?? {},
    applyCollapseUpdates: (updates) => args.canvasApiRef.current?.applyCollapseUpdates(updates),
    startEditNode: (nodeId: string) => args.canvasApiRef.current?.startEditNode?.(nodeId),
    openNodeMetaPopover: (args2) => args.canvasApiRef.current?.openNodeMetaPopover?.(args2),
    createRootAt: (pos: { x: number; y: number }) => args.canvasApiRef.current?.createRootAt?.(pos),
    createSummary: () => args.canvasApiRef.current?.createSummary(),
    startRelation: () => args.canvasApiRef.current?.startRelation(),
    revealWhiteboardElement: (target) => args.canvasApiRef.current?.revealWhiteboardElement?.(target),
    // The open whiteboard editors' commit decides whether a save or a way out of the map goes on (phase-34.25);
    // without a canvas no editor is open.
    commitOpenEditors: () => (args.canvasApiRef.current ? args.canvasApiRef.current.commitOpenEditors() : { ok: true }),
    flushOpenEditorsOnLeave: () => args.canvasApiRef.current?.flushOpenEditorsOnLeave(),
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
    exportLectureSvg: async (args2?: MindMapExportLectureSvgArgs) => {
      const api = args.canvasApiRef.current;
      if (!api?.exportLectureSvg) throw new Error("Lecture SVG export is not ready.");
      const blob = await api.exportLectureSvg(args2);
      return blobToBytes(blob);
    },
    exportLecturePdf: async (args2?: MindMapExportLecturePdfArgs) => {
      const api = args.canvasApiRef.current;
      if (!api?.exportLecturePdf) throw new Error("Lecture PDF export is not ready.");
      const result = await api.exportLecturePdf(args2);
      return { bytes: await blobToBytes(result.blob), pageCount: result.pageCount, metrics: result.metrics };
    },
    exportPngSubtree: async (args2: { nodeId: string; mode?: MindMapExportPngArgs["mode"] | undefined; scale?: number | undefined; beautify?: MindMapExportPngArgs["beautify"] | undefined }) => {
      const api = args.canvasApiRef.current;
      if (!api?.exportPngSubtree) throw new Error("Subtree PNG export is not supported.");
      const result = await api.exportPngSubtree({ nodeId: args2.nodeId, mode: args2.mode, scale: args2.scale, beautify: args2.beautify });
      return { bytes: await blobToBytes(result.blob), usedFallback: result.usedFallback };
    },
  }, args.canvasApiRef);
}

export function KmindObsidianViewApp(props: {
  hostApp: App;
  file: TFile | null;
  /**
   * The keys this view takes from Obsidian's hotkeys right now (phase-34.16): the view's Obsidian scope claims
   * them, so that a press does not also run an Obsidian command bound to the same keys. Whiteboard mode only.
   */
  claimHostKeys?: ((combos: readonly KeyCombo[]) => void) | undefined;
}) {
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
  const [initError, setInitError] = useState<{ error: Error; file: TFile } | null>(null);
  const presentation = useWorkspacePresentation();
  const runtimeRef = useRef<ObsidianRuntime | null>(null);
  const rootElRef = useRef<HTMLDivElement | null>(null);
  // The whiteboard is only shown where the primary pointer of the view's window (a pop-out has its own) is touch
  // (phase-34.33): the one judgment of `@kmind/editor-react`. The plugin loads on the desktop only: no phone or tablet
  // judgment of its own.
  const viewWindow = useOwnerWindow(rootElRef);
  const whiteboardViewOnlyDevice = useWhiteboardViewOnlyDevice({ hostMobile: false, ownerWindow: viewWindow });
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
        if (cancelled) return;
        setInitError({ error: error instanceof Error ? error : new Error(uiT("obsidian.error.unknown")), file });
      }
    })();

    return () => {
      cancelled = true;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
    // Keyed by the file object: a rename keeps the runtime, its edit lease and its undo history.
  }, [props.file, props.hostApp, licenseReady, uiT]);

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
    // History thumbnails only: map files carry no rendered preview since phase-25.7.
    runtime.preview.setHistoryExporter(async () => {
      const api = canvasApiRef.current;
      if (!api) return null;
      const blob = await api.exportSvg({ mode: "portable", scope: "current" });
      return blob.text();
    });
    return () => {
      try {
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
      const inWhiteboardEditor = isWhiteboardEditorTarget(event.target);
      // The keys of a text field and a focused control's own keys; ⌘Z or Delete on a button reach the canvas (phase-34.54).
      if (isTypingKeyEvent(event) && !inWhiteboardEditor) return;

      const current = snapshotRef.current;
      if (!current) return;
      const bindings = resolveEffectiveKeymap(current.registry.keymap, keymapOverrides, { hostId: runtime.app.host.id });
      const route = resolveHostShortcutRoute({
        bindings,
        event,
        typingTarget: inWhiteboardEditor,
        whiteboardEditorTarget: inWhiteboardEditor,
        editor: current.editor,
      });
      // The save key in a whiteboard editor saves like the save button (phase-34.17); other keys there are typing.
      if (inWhiteboardEditor && route.kind !== "editor-save") return;
      if (route.kind === "none" || route.kind === "canvas") return;
      if (route.kind === "prevent-default") {
        event.preventDefault();
        return;
      }
      const match = route.binding;
      if (!runtime.app.isCommandEnabled(match.commandId, match.args)) {
        // The save key of a whiteboard editor never reaches the browser (its "save page").
        if (route.kind === "editor-save") event.preventDefault();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void runtime.app.dispatch(match.commandId, match.args).finally(() => runtime.app.focusCanvas()).catch(rethrowUnlessWhiteboardEditorUncommitted);
    };

    win.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      win.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [keymapOverrides, runtime]);

  // Obsidian's hotkeys run before this view's window listener, and a press KMind takes would also run an
  // Obsidian command bound to the same keys. In whiteboard mode the view's Obsidian scope claims the keys the
  // whiteboard and the host bindings take (phase-34.16, Q9); in map mode it claims nothing (unchanged). The
  // whiteboard's single-key tool shortcuts are claimed only while they act (phase-34.55): the canvas has the focus, the
  // whiteboard is in context, no node is selected and nothing is typed (`whiteboardToolKeysActive`), so a single key
  // pressed anywhere else in Obsidian stays Obsidian's.
  const whiteboardInputActive = snapshot?.editor.whiteboardInputActive ?? false;
  const whiteboardToolKeysActive = snapshot?.editor.whiteboardToolKeysActive ?? false;
  const registryKeymap = snapshot?.registry.keymap ?? null;
  const ownedHostKeys = useMemo(() => {
    if (!runtime || !registryKeymap) return [];
    return resolveObsidianClaimedCombos({
      bindings: resolveEffectiveKeymap(registryKeymap, keymapOverrides, { hostId: runtime.app.host.id }),
      whiteboardInputActive,
      whiteboardToolKeysActive,
    });
  }, [keymapOverrides, registryKeymap, runtime, whiteboardInputActive, whiteboardToolKeysActive]);
  const claimHostKeys = props.claimHostKeys;
  useEffect(() => {
    claimHostKeys?.(ownedHostKeys);
  }, [claimHostKeys, ownedHostKeys]);
  useEffect(() => () => claimHostKeys?.([]), [claimHostKeys]);

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

  // The history panel belongs to the floating toolbar; the capsule's notices open it through here.
  const historyOpenerRef = useRef<(() => void) | null>(null);
  const openHistoryFromNotice = useCallback(() => {
    const openHistory = historyOpenerRef.current;
    if (!openHistory) throw new Error("[kmind-zen] the toolbar that owns the history panel is not mounted.");
    openHistory();
  }, []);
  const workspaceNotices = useProjectWorkspaceNotices({
    app: runtime?.app ?? null,
    editLeaseDetail: uiT("obsidian.editLease.readOnly"),
    onViewHistory: openHistoryFromNotice,
  });

  if (initError && initError.file === props.file) {
    // A file whose whiteboard data or package version this version refuses says why (design §3.3), as
    // does one whose old resource records cannot be upgraded around a read-only map (phase-34.24 fix-1).
    const whiteboardReadFailure = describeWhiteboardReadFailure(uiI18n.t, initError.error)
      ?? describeLegacyMigrationRefusal(uiI18n.t, initError.error);
    return (
      <I18nProvider i18n={uiI18n}>
        <div style={{ padding: 16, fontSize: 13, lineHeight: 1.6, overflow: "auto", height: "100%", boxSizing: "border-box" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{uiT("obsidian.init.failed.title")}</div>
          {whiteboardReadFailure ? <div style={{ marginBottom: 8 }}>{whiteboardReadFailure}</div> : null}
          <ObsidianOpenDiagnostic app={props.hostApp} file={initError.file} error={initError.error} />
          <details><summary>{uiT("obsidian.recovery.open.details")}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{initError.error.message}</pre></details>
          <div style={{ marginTop: 12, color: "#64748b" }}>{uiT("obsidian.init.failed.hint")}</div>
          {props.file ? <div data-km-obsidian-recovery-hint="true" style={{ marginTop: 12 }}>{uiT("obsidian.init.failed.recoveryHint")}</div> : null}
          {props.file ? <ObsidianFailedProjectRecovery app={props.hostApp} file={props.file} /> : null}
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

  const renderMap = (visible = true, crossPaneDrag?: MindMapCrossPaneDragBridge) => (
    <MindMapCanvas
      webViewCompatibilityHost="obsidian"
      canvasApiRef={canvasApiRef}
      className="kmind-zen-canvas"
      core={core}
      performance={performance}
      crossPaneDrag={crossPaneDrag}
      sharedResources={sharedResources ?? undefined}
      documentId={core.id}
      initialSelection="none"
      controlledSelection={snapshot.editor.controlledSelection}
      backlinksIndex={snapshot.editor.backlinksIndex}
      appUi={{
        snapshot,
        selectionToolbar: snapshot.registry.selectionToolbar,
        contextMenus: snapshot.registry.contextMenus,
        keymapOverrides,
        themeCatalog: resolveThemeCatalog,
        workspaceActivityStatus: presentation.isCompact ? undefined : (
          <WorkspaceActivityStatus
            app={runtime.app}
            operation={snapshot.editor.clipboard.operation}
            saveStatus={snapshot.documents.status}
            variant="capsule"
          />
        ),
        // A hidden map (outline mode) must not use up the notices' one-time reveal.
        workspaceNotices: visible ? workspaceNotices : undefined,
        // The compact top toolbar spans the canvas: the capsule goes below it.
        workspaceCapsuleTop: presentation.isCompact ? "calc(env(safe-area-inset-top, 0px) + 80px)" : undefined,
        // The project search panel opens in the capsule's corner.
        workspaceCapsuleHidden: snapshot.editor.projectSearch.open,
        dispatchCommand: (commandId, args) => runtime.app.dispatch(commandId, args).finally(() => runtime.app.focusCanvas()).catch(rethrowUnlessWhiteboardEditorUncommitted),
        isCommandEnabled: (commandId, args) => runtime.app.isCommandEnabled(commandId, args),
      }}
      dialog={runtime.app.host.ports.dialog}
      clipboard={runtime.app.host.ports.clipboard}
      external={runtime.app.host.ports.external}
      storage={runtime.app.host.ports.storage}
      assetUrls={runtime.app.host.ports.assetUrls}
      assets={runtime.app.host.ports.assets}
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
        wheelBehavior: hostDefaults.wheelBehavior,
        collapseToggleVisibility: presentation.isCompact ? "always" : "hover",
        blankDoubleClickAction: readOnlyMode ? "none" : "add-root",
        // The whiteboard's blank gestures and image routing (phase-34.54), from the plugin settings.
        whiteboardModifier: hostDefaults.whiteboardModifier,
        blankDragSelectsWhiteboard: hostDefaults.blankDragSelectsWhiteboard,
        unselectedImageTarget: hostDefaults.unselectedImageTarget,
        whiteboardToolbarWheel: hostDefaults.whiteboardToolbarWheel,
        smartPaste: !readOnlyMode,
        showDetachedRootHint: false,
        readOnly: readOnlyMode,
        // Shown everywhere; editable while the map is shown (outline mode hides it, phase-34.10 Q6), except where the
        // view's primary pointer is touch (`whiteboardViewOnlyDevice`, phase-34.33). Design §7.1, phase-34.15 Q2.
        whiteboard: resolveHostWhiteboardProps({
          hostEnabled: snapshot.capabilities.whiteboard.enabled,
          mapVisible: visible,
          viewOnlyDevice: whiteboardViewOnlyDevice,
        }),
      }}
      submap={{
        canGoBack: snapshot.navigation.path.length > 1,
        enterSubmap: (nodeId) => {
          void runtime.app.dispatch("submap.enter", { nodeId }).finally(() => runtime.app.focusCanvas()).catch(rethrowUnlessWhiteboardEditorUncommitted);
        },
        backToParentMap: () => {
          void runtime.app.dispatch("submap.back").finally(() => runtime.app.focusCanvas()).catch(rethrowUnlessWhiteboardEditorUncommitted);
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
          return saveNodeNotesImmediately(runtime.app, {
            type: "set",
            nodeId: action.nodeId,
            doc: action.doc,
            html: action.html,
            assets: action.assets,
          }).then(() => runtime.app.focusCanvas());
        }
        if (action.type === "notes.clear") {
          return saveNodeNotesImmediately(runtime.app, { type: "clear", nodeId: action.nodeId }).then(() => runtime.app.focusCanvas());
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
      onWhiteboardInputStateChange={(state) => {
        runtime.app.setWhiteboardInputState(state);
      }}
      // The remembered whiteboard tool styles (phase-34.55), in the plugin's settings file: one write per settled run of
      // style changes.
      whiteboardToolPreferences={hostDefaults.whiteboardToolPreferences}
      onWhiteboardToolPreferencesChange={(whiteboardToolPreferences) => {
        void kmindZenViewModesDefaultsStore.set(props.hostApp, { whiteboardToolPreferences });
      }}
      onControlledSelectionChange={({ primary, selectedNodeIds }) => {
        runtime.app.setControlledSelection({ primary, selectedNodeIds, source: "map" });
      }}
      onCameraChange={(next) => {
        setCamera(next);
      }}
      onMinimapChange={(next) => {
        setMinimap(next);
      }}
      onOpenNodeRef={(ref) => {
        void runtime.app.dispatch("node.link.open", ref).finally(() => runtime.app.focusCanvas()).catch(rethrowUnlessWhiteboardEditorUncommitted);
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
      historyOpener={historyOpenerRef}
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
        style={{ position: "absolute", inset: 0 }}
      >
        {/* A render error around the editor (toolbars, panels) shows the error view here instead of an empty
            view (phase-34.16 Q10); the workspace registers its top bar for the whiteboard entry (Q12). */}
        <KmindHostSurfaceErrorBoundary resetKeys={[runtime, props.file]}>
        <WorkspaceTopChromeScope>
        <KmindOutlineWorkspace
          app={runtime.app}
          assetUrls={runtime.app.host.ports.assetUrls}
          core={core}
          nodeRefResolveStore={runtime.nodeRefResolver}
          onPremiumFeatureBlocked={requestPremiumFeature}
          onOpenNodeRef={(ref) => {
            void runtime.app.dispatch("node.link.open", ref).finally(() => runtime.app.focusCanvas()).catch(rethrowUnlessWhiteboardEditorUncommitted);
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
        </WorkspaceTopChromeScope>
        </KmindHostSurfaceErrorBoundary>
      </div>
    </I18nProvider>
  );
}
