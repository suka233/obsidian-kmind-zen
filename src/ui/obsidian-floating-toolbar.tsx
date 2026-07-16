import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

import type {
  DocumentExportKind,
  DocumentExportPngScale,
  KmindApp,
  KmindAppSnapshot,
  MindMapExportImageBeautifyPreset,
  MindMapExportScope,
  ReachableMapSummary,
} from "@kmind/app";
import {
  ALL_LAYOUT_TYPES,
  DEFAULT_DOCUMENT_EXPORT_KIND,
  DEFAULT_DOCUMENT_EXPORT_PNG_SCALE,
  DOCUMENT_LECTURE_EXPORTS_ENABLED,
  PROJECT_LAYOUT_DENSITY_PRESETS_V1,
  THEME_PRESETS_APP,
  collectProjectMapSummaries,
  getProjectManifestV1,
  isTidyOnlyLayout,
  listDocumentExportFormats,
  listLocalThemeCatalogItems,
  resolveDefaultRootLayoutFromDoc,
  resolveDocumentExportBehavior,
  resolveProjectBackgroundColorFromDoc,
  resolveProjectLayoutDensityPresetIdV1,
} from "@kmind/app";
import {
  AppAboutPopover,
  DocumentExportBeautifyControls,
  DocumentExportPngQualityControls,
  ProjectSettingsPopover,
  isToolbarButton,
  isToolbarMenu,
  isToolbarPopover,
  listToolbarItemsForArea,
  resolveToolbarMenuItems,
  type LayoutPreviewKind,
  type ProjectSettingsBackgroundPreset,
  type ProjectSettingsDensityPreset,
  type ProjectSettingsLayoutOption,
  type ProjectSettingsThemeOption,
} from "@kmind/app-react";
import { resolveThemeDefinition } from "@kmind/core";
import {
  isNodeLike,
  minimapPointToWorldPoint,
  resolveOwnerWindow,
  resolveMinimapTransform,
  resolveLocalizedLayoutLabel,
  resolveLocalizedThemePresetName,
  useLocale,
  useT,
  useWorkspacePresentation,
  worldPointToMinimapPoint,
  worldRectToMinimapRect,
  type MindMapCameraState,
  type MindMapMinimapModel,
} from "@kmind/editor-react";
import { getBuiltinIconSvg } from "@kmind/icons";
import type { App, TFile } from "obsidian";

import type { KmindPreviewBridge } from "../host/obsidian/create-obsidian-host-adapter";
import { getObsidianThemeLibraryStoragePort } from "../runtime/theme-library-storage";

import { ProjectSearchPopover } from "./project-search-popover";
import { HistoryPopover } from "./history-popover";
import { DocumentImportPopover } from "./document-import-popover";

function BuiltinIcon(props: { iconId: string }) {
  const svg = getBuiltinIconSvg(props.iconId);
  if (!svg) return null;
  return <span aria-hidden="true" className="kmind-zen-icon" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function ToolbarButton(props: { title: string; iconId?: string | undefined; disabled?: boolean; active?: boolean; onClick: () => void }) {
  const isIconOnly = typeof props.iconId === "string" && props.iconId.trim().length > 0;
  const className = [
    "kmind-zen-btn",
    isIconOnly ? "kmind-zen-btn--icon" : "",
    props.active ? "kmind-zen-btn--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      aria-label={props.title}
      className={className}
      disabled={props.disabled}
      onClick={props.onClick}
      tabIndex={-1}
      title={props.title}
      type="button"
    >
      {isIconOnly ? <BuiltinIcon iconId={props.iconId!} /> : props.title}
    </button>
  );
}

function resolveLayoutPreview(layout: string): LayoutPreviewKind | undefined {
  if (
    layout === "logical-right"
    || layout === "logical-left"
    || layout === "tree-down"
    || layout === "tree-up"
    || layout === "mindmap-both"
    || layout === "mindmap-both-auto"
  ) return layout;
  return undefined;
}

type FixedPopoverPlacement = "right-start" | "bottom-start";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeClampedPopoverStyle(args: {
  rootRect: DOMRect;
  anchorRect: DOMRect;
  width: number;
  maxHeight: number;
  placement: FixedPopoverPlacement;
}): CSSProperties {
  const padding = 10;
  const offset = 8;
  const rootWidth = args.rootRect.width;
  const rootHeight = args.rootRect.height;
  const width = Math.max(220, Math.min(args.width, Math.max(220, rootWidth - padding * 2)));
  const maxHeight = Math.max(200, Math.min(args.maxHeight, Math.max(200, rootHeight - padding * 2)));

  const anchorLeft = args.anchorRect.left - args.rootRect.left;
  const anchorRight = args.anchorRect.right - args.rootRect.left;
  const anchorTop = args.anchorRect.top - args.rootRect.top;
  const anchorBottom = args.anchorRect.bottom - args.rootRect.top;

  let left = args.placement === "right-start" ? anchorRight + offset : anchorLeft;
  let top = args.placement === "bottom-start" ? anchorBottom + offset : anchorTop;

  if (args.placement === "right-start" && left + width > rootWidth - padding) {
    left = anchorLeft - offset - width;
  }

  if (args.placement === "bottom-start" && top + maxHeight > rootHeight - padding) {
    top = anchorTop - offset - maxHeight;
  }

  left = clampNumber(left, padding, Math.max(padding, rootWidth - width - padding));
  top = clampNumber(top, padding, Math.max(padding, rootHeight - maxHeight - padding));

  return {
    position: "absolute",
    left,
    top,
    width,
    minWidth: 0,
    maxWidth: Math.max(220, rootWidth - padding * 2),
    maxHeight,
  };
}

function useClampedPopoverStyle(args: {
  open: boolean;
  rootRef: RefObject<HTMLElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
  width: number;
  maxHeight: number;
  placement: FixedPopoverPlacement;
}): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!args.open) return;
    const root = args.rootRef.current;
    const anchor = args.anchorRef.current;
    if (!root || !anchor) return;

    let rafId: number | null = null;
    const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (fn: FrameRequestCallback) => setTimeout(fn, 0) as unknown as number;

    const update = () => {
      const rootEl = args.rootRef.current;
      const anchorEl = args.anchorRef.current;
      if (!rootEl || !anchorEl) return;
      setStyle(
        computeClampedPopoverStyle({
          rootRect: rootEl.getBoundingClientRect(),
          anchorRect: anchorEl.getBoundingClientRect(),
          width: args.width,
          maxHeight: args.maxHeight,
          placement: args.placement,
        }),
      );
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = raf(() => {
        rafId = null;
        update();
      });
    };

    schedule();

    const win = resolveOwnerWindow(root) ?? (typeof window !== "undefined" ? window : null);
    if (!win) return;
    const onScroll = () => schedule();
    const onResize = () => schedule();
    win.addEventListener("resize", onResize);
    win.addEventListener("scroll", onScroll, true);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => schedule());
      resizeObserver.observe(root);
      resizeObserver.observe(anchor);
    }

    return () => {
      if (rafId !== null) caf(rafId);
      win.removeEventListener("resize", onResize);
      win.removeEventListener("scroll", onScroll, true);
      resizeObserver?.disconnect();
    };
  }, [args.anchorRef, args.maxHeight, args.open, args.placement, args.rootRef, args.width]);

  return style;
}

function ExportHint(props: { kind: "recommended-package" | "png-package" }) {
  const t = useT();
  const isRecommended = props.kind === "recommended-package";

  return (
    <div
      style={{
        border: "1px solid rgba(99, 102, 241, 0.22)",
        background: "rgba(99, 102, 241, 0.08)",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {isRecommended ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              background: "rgba(99, 102, 241, 0.92)",
              color: "#fff",
            }}
          >
            {t("appPage.popover.export.hint.recommended.badge")}
          </span>
        ) : null}
        <div style={{ fontSize: 12, fontWeight: 700 }}>
          {isRecommended ? t("appPage.popover.export.hint.recommended.title") : t("appPage.popover.export.hint.pngPackage.title")}
        </div>
      </div>
      <div className="kmind-zen-subtle" style={{ marginTop: 8, lineHeight: 1.5 }}>
        {isRecommended ? t("appPage.popover.export.hint.recommended.body") : t("appPage.popover.export.hint.pngPackage.body")}
      </div>
    </div>
  );
}

type ExportKind = DocumentExportKind;

function DocumentExportPopover(props: { app: KmindApp; snapshot: KmindAppSnapshot; onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<ExportKind>(DEFAULT_DOCUMENT_EXPORT_KIND);
  const [scope, setScope] = useState<MindMapExportScope>("current");
  const [pngScale, setPngScale] = useState<DocumentExportPngScale>(DEFAULT_DOCUMENT_EXPORT_PNG_SCALE);
  const [beautify, setBeautify] = useState<MindMapExportImageBeautifyPreset>({ kind: "none" });
  const [exporting, setExporting] = useState(false);
  const canShowLectureExports = DOCUMENT_LECTURE_EXPORTS_ENABLED && props.snapshot.capabilities.whiteboard.enabled;
  const exportFormats = useMemo(
    () => listDocumentExportFormats({ lectureExportsEnabled: canShowLectureExports }),
    [canShowLectureExports],
  );
  const effectiveKind: DocumentExportKind = exportFormats.some((format) => format.kind === kind) ? kind : DEFAULT_DOCUMENT_EXPORT_KIND;

  const behavior = useMemo(
    () => resolveDocumentExportBehavior(effectiveKind, scope, effectiveKind === "png" ? { beautify, scale: pngScale } : undefined),
    [beautify, effectiveKind, pngScale, scope],
  );
  const args = behavior.svgArgs ?? behavior.pngArgs ?? behavior.lectureSvgArgs ?? behavior.lecturePdfArgs ?? undefined;
  const canExport = props.app.isCommandEnabled(behavior.commandId, args);

  return (
    <>
      <div
        className="kmind-zen-popover__header"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{t("appPage.popover.export.title")}</div>
          <div style={{ marginTop: 4, fontSize: 12, fontWeight: 500, color: "var(--kmind-zen-muted)", lineHeight: 1.35 }}>
            {t("appPage.popover.export.subtitle")}
          </div>
        </div>
        <button className="kmind-zen-link" onClick={props.onClose} type="button">
          {t("kmind.common.close")}
        </button>
      </div>

      <div className="kmind-zen-popover__body">
        <div className="kmind-zen-field">
          <div className="kmind-zen-field__label">{t("appPage.popover.export.section.type")}</div>
          <select className="kmind-zen-select" onChange={(event) => setKind(event.target.value as ExportKind)} value={effectiveKind}>
            {exportFormats.map((format) => (
              <option key={format.kind} value={format.kind}>
                {t(format.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {behavior.supportsScope ? (
          <div className="kmind-zen-field">
            <div className="kmind-zen-field__label">{t("appPage.popover.export.section.scope")}</div>
            <label className="kmind-zen-checkbox">
              <input
                checked={scope === "expanded"}
                onChange={(event) => setScope(event.target.checked ? "expanded" : "current")}
                type="checkbox"
              />
              {t("appPage.popover.export.scope.expanded")}
            </label>
          </div>
        ) : null}

        {effectiveKind === "png" ? (
          <>
            <DocumentExportPngQualityControls onChange={setPngScale} value={pngScale} />
            <DocumentExportBeautifyControls onChange={setBeautify} value={beautify} />
          </>
        ) : null}

        {behavior.hintKind ? <ExportHint kind={behavior.hintKind} /> : null}

        <div className="kmind-zen-footer">
          <button className="kmind-zen-btn" onClick={props.onClose} type="button">
            {t("kmind.common.cancel")}
          </button>
          <button
            className="kmind-zen-btn kmind-zen-btn--primary"
            disabled={!canExport || exporting}
            onClick={() => {
              if (!canExport) return;
              setExporting(true);
              void props.app
                .dispatch(behavior.commandId, args)
                .then(() => props.onClose())
                .finally(() => {
                  setExporting(false);
                  props.app.focusCanvas();
                });
            }}
            type="button"
          >
            {exporting ? t("appPage.popover.export.action.exporting") : t("appPage.popover.export.action.export")}
          </button>
        </div>
      </div>
    </>
  );
}

export function ObsidianFloatingToolbar(props: {
  hostApp: App;
  file: TFile;
  app: KmindApp;
  preview: KmindPreviewBridge;
  snapshot: KmindAppSnapshot;
  camera: MindMapCameraState | null;
  minimap: MindMapMinimapModel | null;
  onProjectBackgroundDraftChange?: ((color: string | null) => void) | undefined;
  onOpenUpdateDialog?: (() => void) | undefined;
  viewModeControl?: ReactNode | undefined;
}) {
  const t = useT();
  const locale = useLocale();
  const presentation = useWorkspacePresentation();
  const isCompact = presentation.isCompact;
  const viewModes = props.snapshot.editor.viewModes;
  const zenMode = viewModes.zenMode.value;
  const readOnlyMode = viewModes.readOnly.value;
  const projectSearch = props.snapshot.editor.projectSearch;

  const rootRef = useRef<HTMLDivElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const zoomInputRef = useRef<HTMLInputElement>(null);
  const exportButtonRef = useRef<HTMLDivElement>(null);
  const importButtonRef = useRef<HTMLDivElement>(null);
  const projectButtonRef = useRef<HTMLDivElement>(null);
  const historyButtonRef = useRef<HTMLDivElement>(null);
  type OpenPopoverId = null | "export" | "import" | "minimap" | "project" | "history" | "about";
  const [openPopover, setOpenPopover] = useState<OpenPopoverId>(null);
  const themeLibraryStorage = useMemo(() => getObsidianThemeLibraryStoragePort(props.hostApp), [props.hostApp]);
  const [themeLibraryVersion, setThemeLibraryVersion] = useState(0);
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
  }, [themeLibraryStorage, openPopover]);
  const [tabMenu, setTabMenu] = useState<null | { docId: string; title: string; x: number; y: number; mode: "menu" | "rename" | "delete" }>(null);
  const [tabMenuDraftTitle, setTabMenuDraftTitle] = useState("");
  const tabMenuInputRef = useRef<HTMLInputElement>(null);
  const [projectMaps, setProjectMaps] = useState<ReachableMapSummary[]>([]);
  const [projectMapsLoading, setProjectMapsLoading] = useState(false);
  const projectMapsRequestIdRef = useRef(0);
  const [projectDefaultRootLayoutFromStore, setProjectDefaultRootLayoutFromStore] = useState<string | null>(null);
  const [editingZoom, setEditingZoom] = useState(false);
  const [draftZoom, setDraftZoom] = useState("");

  const minimapDragPointerIdRef = useRef<number | null>(null);
  const [minimapDragging, setMinimapDragging] = useState(false);
  const minimapDragOffsetWorldRef = useRef<{ x: number; y: number } | null>(null);
  const minimapPanRafRef = useRef<number | null>(null);
  const pendingMinimapPanRef = useRef<{ x: number; y: number } | null>(null);

  const exportPopoverStyle = useClampedPopoverStyle({
    open: openPopover === "export",
    rootRef,
    anchorRef: exportButtonRef,
    width: 360,
    maxHeight: 520,
    placement: "bottom-start",
  });

  const importPopoverStyle = useClampedPopoverStyle({
    open: openPopover === "import",
    rootRef,
    anchorRef: importButtonRef,
    width: 520,
    maxHeight: 620,
    placement: "bottom-start",
  });

  const projectPopoverStyle = useClampedPopoverStyle({
    open: openPopover === "project",
    rootRef,
    anchorRef: projectButtonRef,
    width: 430,
    maxHeight: 720,
    placement: "right-start",
  });

  const historyPopoverStyle = useClampedPopoverStyle({
    open: openPopover === "history",
    rootRef,
    anchorRef: historyButtonRef,
    width: 440,
    maxHeight: 520,
    placement: "right-start",
  });

  const requestSetOpenPopover = useCallback(
    async (next: OpenPopoverId) => {
      setOpenPopover(next);
      setTabMenu(null);
      setEditingZoom(false);
      return true;
    },
    [],
  );

  const togglePopover = useCallback(
    (id: Exclude<OpenPopoverId, null>) => {
      void requestSetOpenPopover(openPopover === id ? null : id);
    },
    [openPopover, requestSetOpenPopover],
  );

  useEffect(() => {
    if (!readOnlyMode) return;
    setTabMenu(null);
    setOpenPopover((prev) => (prev === "project" || prev === "history" || prev === "import" ? null : prev));
  }, [readOnlyMode]);

  useEffect(() => {
    if (!projectSearch.open) return;
    void requestSetOpenPopover(null);
  }, [projectSearch.open, requestSetOpenPopover]);

  useEffect(() => {
    if (!editingZoom) return;
    const handle = setTimeout(() => zoomInputRef.current?.focus(), 0);
    return () => clearTimeout(handle);
  }, [editingZoom]);

  const scheduleMinimapPanTo = (payload: { x: number; y: number }) => {
    pendingMinimapPanRef.current = payload;
    if (minimapPanRafRef.current !== null) return;
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (fn: FrameRequestCallback) => setTimeout(fn, 16) as unknown as number;
    minimapPanRafRef.current = raf(() => {
      minimapPanRafRef.current = null;
      const next = pendingMinimapPanRef.current;
      pendingMinimapPanRef.current = null;
      if (!next) return;
      void props.app.dispatch("mindmap.panTo", next).finally(() => props.app.focusCanvas());
    });
  };

  useEffect(() => {
    return () => {
      const handle = minimapPanRafRef.current;
      if (handle === null) return;
      minimapPanRafRef.current = null;
      pendingMinimapPanRef.current = null;
      const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
      caf(handle);
    };
  }, []);

  const rootDocId = props.snapshot.navigation.rootId ?? props.snapshot.documents.activeId;
  const rootRecord = rootDocId ? props.snapshot.documents.items.find((item) => item.id === rootDocId) ?? null : null;
  const projectTitle = rootRecord?.title ?? t("kmind.common.untitled");
  const projectBackgroundColor = rootRecord ? resolveProjectBackgroundColorFromDoc(rootRecord.doc) : null;

  const activeId = props.snapshot.documents.activeId;
  const activeRecord = activeId ? props.snapshot.documents.items.find((item) => item.id === activeId) ?? null : null;
  const activeMapTitle = projectMaps.find((item) => item.docId === activeId)?.title ?? activeRecord?.title ?? "";

  const projectMapsRefreshKey = useMemo(() => {
    const core = props.snapshot.editor.activeCore;
    const doc = core?.getState().document;
    const outgoingKey = (() => {
      if (!doc) return "";
      const submapIds = new Set<string>();
      for (const node of Object.values(doc.nodes)) {
        const subMapId = typeof node.subMapId === "string" ? node.subMapId.trim() : "";
        if (subMapId) submapIds.add(subMapId);
      }
      if (submapIds.size === 0) return "";
      return Array.from(submapIds).sort().join("|");
    })();

    const rootUpdatedAt = rootRecord?.updatedAt ?? 0;
    const manifestKey = rootRecord
      ? (getProjectManifestV1(rootRecord.doc)?.submaps ?? []).join("|")
      : "";

    return `${rootDocId ?? ""}::${rootUpdatedAt}::${manifestKey}::${outgoingKey}`;
  }, [props.snapshot]);

  const refreshProjectMaps = useCallback(() => {
    if (!rootDocId) return;
    const requestId = ++projectMapsRequestIdRef.current;
    setProjectMapsLoading(true);
    void collectProjectMapSummaries({ rootDocId, documents: props.app.host.ports.documents, includeRoot: true })
      .then((items) => {
        if (requestId !== projectMapsRequestIdRef.current) return;
        setProjectMaps(items);
        setProjectMapsLoading(false);
      })
      .catch(() => {
        if (requestId !== projectMapsRequestIdRef.current) return;
        setProjectMapsLoading(false);
      });
  }, [props.app.host.ports.documents, rootDocId]);

  useEffect(() => {
    refreshProjectMaps();
  }, [refreshProjectMaps, activeId, projectMapsRefreshKey]);

  const saveStatus = props.snapshot.documents.status;
  const saveBadge = (() => {
    if (saveStatus.saving) return t("appPage.floatingToolbar.saveBadge.saving");
    if (saveStatus.lastSaveError) return t("appPage.floatingToolbar.saveBadge.saveFailed");
    if (saveStatus.dirty) return t("appPage.floatingToolbar.saveBadge.unsaved");
    if (saveStatus.lastSavedAt) return t("appPage.floatingToolbar.saveBadge.saved");
    return null;
  })();

  const topLeftToolbarItems = useMemo(() => listToolbarItemsForArea(props.snapshot, "top-left", { hostId: "obsidian" }), [props.snapshot]);
  const leftRailToolbarItems = useMemo(() => listToolbarItemsForArea(props.snapshot, "left-rail", { hostId: "obsidian" }), [props.snapshot]);
  const bottomRightToolbarItems = useMemo(() => listToolbarItemsForArea(props.snapshot, "bottom-right", { hostId: "obsidian" }), [props.snapshot]);

  const zoom = props.camera?.zoom ?? 1;
  const zoomLabel = `${Math.round(zoom * 100)}%`;

  const isToolbarButtonActive = (commandId: string): boolean => {
    if (commandId === "view.zen.toggle") return zenMode;
    if (commandId === "view.readOnly.toggle") return readOnlyMode;
    if (commandId === "project.search.toggle") return projectSearch.open;
    return false;
  };

  const supportedProjectLayouts = props.snapshot.editor.layoutEngine === "tidy"
    ? ALL_LAYOUT_TYPES
    : ALL_LAYOUT_TYPES.filter((layout) => !isTidyOnlyLayout(layout));
  const rootLayoutAllowlist = props.snapshot.capabilities.layout.rootLayoutAllowlist;
  const projectLayouts = rootLayoutAllowlist
    ? supportedProjectLayouts.filter((layout) => rootLayoutAllowlist.includes(layout))
    : supportedProjectLayouts;
  const projectDefaultRootLayoutFromSnapshot = rootRecord ? resolveDefaultRootLayoutFromDoc(rootRecord.doc) : null;
  const projectDefaultRootLayout = projectDefaultRootLayoutFromStore ?? projectDefaultRootLayoutFromSnapshot;
  const activeThemeId = (() => {
    const doc = props.snapshot.editor.activeCore?.getState().document;
    if (!doc?.theme?.defaultTheme) return null;
    return resolveThemeDefinition(doc.theme.defaultTheme, doc.assets)?.id ?? null;
  })();
  const rainbowEnabled = Boolean(props.snapshot.editor.activeCore?.getState().document.theme?.rainbow?.enabled);
  const themeBackgroundFallback = useMemo(() => {
    const preset = activeThemeId ? THEME_PRESETS_APP.find((item) => item.theme.id === activeThemeId) ?? null : null;
    const variant = preset?.theme.variants.light;
    return variant?.background?.color ?? variant?.tokens.paint.bg ?? "#ffffff";
  }, [activeThemeId]);
  const projectBackgroundPickerValue = projectBackgroundColor ?? themeBackgroundFallback;
  const [projectBackgroundDraft, setProjectBackgroundDraft] = useState(projectBackgroundPickerValue);
  const projectBackgroundCommitTimerRef = useRef<number | null>(null);
  const projectBackgroundPendingRef = useRef<string | null>(null);

  useEffect(() => {
    setProjectBackgroundDraft(projectBackgroundPickerValue);
    projectBackgroundPendingRef.current = null;
    const handle = projectBackgroundCommitTimerRef.current;
    if (handle !== null) clearTimeout(handle);
    projectBackgroundCommitTimerRef.current = null;
  }, [projectBackgroundPickerValue]);

  useEffect(() => {
    return () => {
      const handle = projectBackgroundCommitTimerRef.current;
      if (handle !== null) clearTimeout(handle);
      projectBackgroundCommitTimerRef.current = null;
      projectBackgroundPendingRef.current = null;
    };
  }, []);

  const scheduleProjectBackgroundSave = useCallback(
    (nextColor: string | null, args?: { immediate?: boolean }) => {
      const flush = () => {
        projectBackgroundCommitTimerRef.current = null;
        const pending = projectBackgroundPendingRef.current;
        projectBackgroundPendingRef.current = null;
        if (typeof pending === "string") {
          void props.app
            .dispatch("project.background.setColor", { color: pending })
            .finally(() => {
              props.onProjectBackgroundDraftChange?.(null);
              props.app.focusCanvas();
            });
        } else {
          void props.app
            .dispatch("project.background.setColor", { color: null })
            .finally(() => {
              props.onProjectBackgroundDraftChange?.(null);
              props.app.focusCanvas();
            });
        }
      };

      if (nextColor === null) {
        setProjectBackgroundDraft(themeBackgroundFallback);
        props.onProjectBackgroundDraftChange?.(themeBackgroundFallback);
      } else {
        setProjectBackgroundDraft(nextColor);
        props.onProjectBackgroundDraftChange?.(nextColor);
      }

      projectBackgroundPendingRef.current = nextColor;
      const handle = projectBackgroundCommitTimerRef.current;
      if (handle !== null) {
        clearTimeout(handle);
        projectBackgroundCommitTimerRef.current = null;
      }
      if (args?.immediate) {
        flush();
        return;
      }
      projectBackgroundCommitTimerRef.current = setTimeout(flush, 200) as unknown as number;
    },
    [props.app, props.onProjectBackgroundDraftChange, themeBackgroundFallback],
  );

  const projectLayoutOptions = useMemo<ProjectSettingsLayoutOption[]>(
    () =>
      projectLayouts.map((layout) => ({
        value: layout,
        label: resolveLocalizedLayoutLabel(t, layout),
        active: projectDefaultRootLayout === layout,
        preview: resolveLayoutPreview(layout),
      })),
    [locale, projectDefaultRootLayout, projectLayouts, t],
  );
  const activeDensityPresetId = useMemo(() => {
    const layoutOptions = props.snapshot.editor.layoutOptions;
    if (layoutOptions?.rootOptions && Object.keys(layoutOptions.rootOptions).length > 0) return null;
    return resolveProjectLayoutDensityPresetIdV1(layoutOptions ?? null);
  }, [props.snapshot.editor.layoutOptions]);
  const projectDensityPresets = useMemo<ProjectSettingsDensityPreset[]>(
    () =>
      PROJECT_LAYOUT_DENSITY_PRESETS_V1.map((preset) => ({
        id: preset.id,
        label: t(`appPage.floatingToolbar.project.density.${preset.id}`),
        description: t(`appPage.floatingToolbar.project.density.${preset.id}.hint`),
        horizontalGap: preset.layoutOptions.horizontalGap,
        verticalGap: preset.layoutOptions.verticalGap,
        active: activeDensityPresetId === preset.id,
      })),
    [activeDensityPresetId, locale, t],
  );
  const projectThemeOptions = useMemo<ProjectSettingsThemeOption[]>(
    () => {
      const officialThemes = THEME_PRESETS_APP.map((preset) => ({
        catalogKey: `official:${preset.id}`,
        id: preset.id,
        name: resolveLocalizedThemePresetName(t, preset),
        theme: preset.theme,
        source: "official" as const,
        active: Boolean(activeThemeId && preset.theme.id === activeThemeId),
      }));
      const localThemes = listLocalThemeCatalogItems(themeLibraryStorage, { locale, fallbackLocale: "zh-CN" }).map((item) => ({
        catalogKey: item.catalogKey,
        id: item.id,
        name: item.name,
        theme: item.theme,
        source: item.source,
        themePackage: item.themePackage,
        preview: item.preview,
        active: Boolean(activeThemeId && item.theme.id === activeThemeId),
      }));
      return [...officialThemes, ...localThemes];
    },
    [activeThemeId, locale, openPopover, t, themeLibraryStorage, themeLibraryVersion],
  );
  const projectBackgroundPresets = useMemo<ProjectSettingsBackgroundPreset[]>(
    () => [
      { id: "theme", label: t("appPage.floatingToolbar.project.backgroundColor.preset.theme"), color: null, swatch: `linear-gradient(135deg, ${themeBackgroundFallback} 0%, ${themeBackgroundFallback} 52%, rgba(148, 163, 184, 0.28) 52%, rgba(148, 163, 184, 0.28) 100%)` },
      { id: "white", label: t("appPage.floatingToolbar.project.backgroundColor.preset.white"), color: "#ffffff", swatch: "#ffffff" },
      { id: "slate", label: t("appPage.floatingToolbar.project.backgroundColor.preset.slate"), color: "#e2e8f0", swatch: "#e2e8f0" },
      { id: "warm", label: t("appPage.floatingToolbar.project.backgroundColor.preset.warm"), color: "#fdecc8", swatch: "#fdecc8" },
      { id: "mint", label: t("appPage.floatingToolbar.project.backgroundColor.preset.mint"), color: "#c7f0d8", swatch: "#c7f0d8" },
      { id: "sky", label: t("appPage.floatingToolbar.project.backgroundColor.preset.sky"), color: "#dbeafe", swatch: "#dbeafe" },
      { id: "rose", label: t("appPage.floatingToolbar.project.backgroundColor.preset.rose"), color: "#fecdd3", swatch: "#fecdd3" },
      { id: "dark", label: t("appPage.floatingToolbar.project.backgroundColor.preset.dark"), color: "#0f172a", swatch: "#0f172a" },
    ],
    [locale, t, themeBackgroundFallback],
  );
  const renderProjectSettingsPopover = () => (
    <ProjectSettingsPopover
      backgroundColor={projectBackgroundColor}
      backgroundCustomLabel={t("appPage.floatingToolbar.project.backgroundColor.custom")}
      backgroundDescription={t("appPage.floatingToolbar.project.backgroundColor.hint")}
      backgroundLabel={t("appPage.floatingToolbar.project.backgroundColor")}
      backgroundPickerValue={projectBackgroundDraft}
      backgroundPresets={projectBackgroundPresets}
      backgroundResetLabel={t("appPage.floatingToolbar.project.backgroundColor.clear")}
      closeLabel={t("kmind.common.close")}
      currentLayoutLabel={projectDefaultRootLayout ? resolveLocalizedLayoutLabel(t, projectDefaultRootLayout) : resolveLocalizedLayoutLabel(t, "logical-right")}
      currentThemeLabel={projectThemeOptions.find((theme) => theme.active)?.name ?? ""}
      densityPresets={projectDensityPresets}
      densitySectionDescription={t("appPage.floatingToolbar.project.density.hint")}
      densitySectionLabel={t("appPage.floatingToolbar.project.section.density")}
      layoutSectionLabel={t("appPage.floatingToolbar.project.section.layout")}
      layouts={projectLayoutOptions}
      onClose={() => setOpenPopover(null)}
      onSelectLayout={(layout) => {
        setProjectDefaultRootLayoutFromStore(layout);
        void props.app.dispatch("layout.project.setDefaultRootLayout", { layout }).finally(() => props.app.focusCanvas());
      }}
      onSelectDensityPreset={(presetId) => {
        void props.app.dispatch("layout.project.applyDensityPreset", { presetId }).finally(() => props.app.focusCanvas());
      }}
      onSelectTheme={(themeId, theme) => {
        if (theme.themePackage) {
          void props.app.dispatch("theme.applyPackage", { themePackage: theme.themePackage, scope: "project" }).finally(() => props.app.focusCanvas());
          return;
        }
        void props.app.dispatch("theme.applyPreset", { presetId: themeId, scope: "project" }).finally(() => props.app.focusCanvas());
      }}
      onSetBackgroundColor={(color) => scheduleProjectBackgroundSave(color, { immediate: true })}
      onSetRelationStyle={(patch) => {
        void props.app.dispatch("theme.relation.setProjectStyle", { patch }).finally(() => props.app.focusCanvas());
      }}
      onToggleRainbow={() => {
        void props.app.dispatch("theme.rainbow.toggle").finally(() => props.app.focusCanvas());
      }}
      rainbowDescription={t("appPage.floatingToolbar.project.rainbowEdges.hint")}
      rainbowEnabled={rainbowEnabled}
      rainbowLabel={t("appPage.floatingToolbar.project.rainbowEdges")}
      rainbowOffLabel={t("appPage.floatingToolbar.toggle.off")}
      rainbowOnLabel={t("appPage.floatingToolbar.toggle.on")}
      relationDescription={t("appPage.floatingToolbar.project.relationStyle.hint")}
      relationColorInheritLabel={t("appPage.floatingToolbar.project.relationStyle.color.inherit")}
      relationColorLabel={t("appPage.floatingToolbar.project.relationStyle.color")}
      relationDirectionLabel={t("appPage.floatingToolbar.project.relationStyle.direction")}
      relationDirectionLabels={{
        none: t("appPage.floatingToolbar.project.relationStyle.direction.none"),
        forward: t("appPage.floatingToolbar.project.relationStyle.direction.forward"),
        backward: t("appPage.floatingToolbar.project.relationStyle.direction.backward"),
        both: t("appPage.floatingToolbar.project.relationStyle.direction.both"),
      }}
      relationLabel={t("appPage.floatingToolbar.project.relationStyle")}
      relationLineStyleLabel={t("appPage.floatingToolbar.project.relationStyle.line")}
      relationLineStyleLabels={{
        inherit: t("appPage.floatingToolbar.project.relationStyle.line.inherit"),
        dashed: t("appPage.floatingToolbar.project.relationStyle.line.dashed"),
        dotted: t("appPage.floatingToolbar.project.relationStyle.line.dotted"),
      }}
      relationLineWidthInheritLabel={t("appPage.floatingToolbar.project.relationStyle.width.inherit")}
      relationLineWidthLabel={t("appPage.floatingToolbar.project.relationStyle.width")}
      relationResetLabel={t("appPage.floatingToolbar.project.relationStyle.reset")}
      relationStyle={props.snapshot.editor.activeCore?.getState().document.theme?.relationStyle ?? null}
      themeSectionLabel={t("appPage.floatingToolbar.project.section.theme")}
      themes={projectThemeOptions}
      title={t("appPage.floatingToolbar.project.title")}
    />
  );

  const stats = useMemo(() => {
    const doc = props.snapshot.editor.activeCore?.getState().document;
    if (!doc) return null;
    const rootCount = doc.roots.length;
    const nodeCount = Object.keys(doc.nodes).length;
    const wordCount = Object.values(doc.nodes)
      .map((node) => node.text ?? "")
      .join(" ")
      .trim()
      .split(/\\s+/)
      .filter(Boolean).length;
    return { rootCount, nodeCount, wordCount };
  }, [props.snapshot]);

  const minimapModel = props.minimap;
  const minimapView = useMemo(() => {
    if (!minimapModel) return null;

    const camera = props.camera;
    const viewBox = camera?.viewBox
      ?? (camera?.viewport
        ? {
            x: camera.x,
            y: camera.y,
            width: camera.viewport.width / camera.zoom,
            height: camera.viewport.height / camera.zoom,
          }
        : null);

    const content = minimapModel.bounds;
    let minX = content.minX;
    let minY = content.minY;
    let maxX = content.maxX;
    let maxY = content.maxY;
    if (viewBox) {
      minX = Math.min(minX, viewBox.x);
      minY = Math.min(minY, viewBox.y);
      maxX = Math.max(maxX, viewBox.x + viewBox.width);
      maxY = Math.max(maxY, viewBox.y + viewBox.height);
    }

    const worldWidth = Math.max(1, maxX - minX);
    const worldHeight = Math.max(1, maxY - minY);
    const transform = resolveMinimapTransform({
      world: {
        minX,
        minY,
        maxX,
        maxY,
        width: worldWidth,
        height: worldHeight,
      },
      viewport: { width: 280, height: 140, padding: 10 },
    });

    const contentRect = worldRectToMinimapRect(transform, {
      x: content.minX,
      y: content.minY,
      width: content.width,
      height: content.height,
    });
    const viewportRect = viewBox ? worldRectToMinimapRect(transform, viewBox) : null;

    const rootSet = new Set(minimapModel.roots);
    const selection = props.snapshot.editor.selection;
    const selectedId = selection?.type === "node" || selection?.type === "summary" ? selection.id : null;

    const doc = props.snapshot.editor.activeCore?.getState().document ?? null;
    const resolveTitle = (id: string) => doc?.nodes?.[id]?.text ?? id;

    return { transform, contentRect, viewportRect, viewBox, rootSet, selectedId, resolveTitle };
  }, [minimapModel, props.camera, props.snapshot]);

  useEffect(() => {
    if (!openPopover && !tabMenu) return;
    const win = resolveOwnerWindow(rootRef.current) ?? (typeof window !== "undefined" ? window : null);
    if (!win) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!isNodeLike(target)) return;
      if (rootRef.current?.contains(target)) return;
      void requestSetOpenPopover(null);
    };
    win.addEventListener("pointerdown", onPointerDown, true);
    return () => win.removeEventListener("pointerdown", onPointerDown, true);
  }, [openPopover, requestSetOpenPopover, tabMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      void requestSetOpenPopover(null);
      if (projectSearch.open) {
        void props.app.dispatch("project.search.close").finally(() => props.app.focusCanvas());
      }
    };
    const win = resolveOwnerWindow(rootRef.current) ?? (typeof window !== "undefined" ? window : null);
    if (!win) return;
    win.addEventListener("keydown", onKeyDown, true);
    return () => win.removeEventListener("keydown", onKeyDown, true);
  }, [projectSearch.open, props.app, requestSetOpenPopover]);

  useLayoutEffect(() => {
    if (!tabMenu) return;
    const element = tabMenuRef.current;
    const root = rootRef.current;
    if (!root) return;
    if (!element) return;
    const padding = 10;
    const rootRect = root.getBoundingClientRect();
    const viewportWidth = rootRect.width;
    const viewportHeight = rootRect.height;
    const menuWidth = element.offsetWidth;
    const menuHeight = element.offsetHeight;
    const maxX = Math.max(padding, viewportWidth - menuWidth - padding);
    const maxY = Math.max(padding, viewportHeight - menuHeight - padding);
    const nextX = Math.min(Math.max(tabMenu.x, padding), maxX);
    const nextY = Math.min(Math.max(tabMenu.y, padding), maxY);
    if (nextX === tabMenu.x && nextY === tabMenu.y) return;
    setTabMenu((prev) => (prev ? { ...prev, x: nextX, y: nextY } : prev));
  }, [tabMenu]);

  useEffect(() => {
    if (!tabMenu) return;
    if (tabMenu.mode !== "rename") return;
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (fn: FrameRequestCallback) => setTimeout(fn, 0) as unknown as number;
    const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
    const handle = raf(() => {
      try {
        tabMenuInputRef.current?.focus();
        tabMenuInputRef.current?.select();
      } catch {
        // ignore
      }
    });
    return () => caf(handle);
  }, [tabMenu]);

  useEffect(() => {
    if (openPopover !== "project") return;
    if (!rootDocId) return;
    let cancelled = false;
    void props.app.host.ports.documents
      .get(rootDocId)
      .then((record) => {
        if (cancelled) return;
        setProjectDefaultRootLayoutFromStore(record ? resolveDefaultRootLayoutFromDoc(record.doc) : null);
      })
      .catch(() => {
        if (cancelled) return;
        setProjectDefaultRootLayoutFromStore(null);
      });
    return () => {
      cancelled = true;
    };
  }, [openPopover, props.app.host.ports.documents, rootDocId]);

  return (
    <div ref={rootRef} className={["kmind-zen-floating", isCompact ? "kmind-zen-floating--compact" : ""].filter(Boolean).join(" ")}>
      <div className={["kmind-zen-bar", "kmind-zen-bar--top", zenMode ? "kmind-zen-bar--hidden" : ""].filter(Boolean).join(" ")}>
        <div className="kmind-zen-brand" title={projectTitle}>KMind</div>
        <div className="kmind-zen-divider" />
        {props.viewModeControl ? <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>{props.viewModeControl}</div> : null}

        {topLeftToolbarItems.map((item) => {
          if (isToolbarButton(item)) {
            return (
              <ToolbarButton
                key={item.id}
                active={isToolbarButtonActive(item.commandId)}
                disabled={!props.app.isCommandEnabled(item.commandId, item.args)}
                iconId={item.icon}
                onClick={() => void props.app.dispatch(item.commandId, item.args).finally(() => props.app.focusCanvas())}
                title={item.title}
              />
            );
          }
          if (isToolbarMenu(item)) {
            const items = resolveToolbarMenuItems(item, props.snapshot);
            return (
              <div key={item.id} style={{ position: "relative" }}>
                <ToolbarButton active={openPopover === item.id} iconId={item.icon} onClick={() => togglePopover(item.id as any)} title={item.title} />
                {openPopover === item.id ? (
                  <div className="kmind-zen-popover" style={{ left: 0, top: "calc(100% + 8px)", width: 280, overflowX: "hidden", overflowY: "auto" }}>
                    <div className="kmind-zen-popover__header">{item.title}</div>
                    <div className="kmind-zen-popover__body" style={{ display: "grid", gap: 6 }}>
                      {items.map((menuItem) => (
                        <button
                          key={menuItem.id}
                          className="kmind-zen-btn"
                          disabled={!props.app.isCommandEnabled(menuItem.commandId, menuItem.args)}
                          onClick={() => {
                            void requestSetOpenPopover(null);
                            void props.app.dispatch(menuItem.commandId, menuItem.args).finally(() => props.app.focusCanvas());
                          }}
                          tabIndex={-1}
                          type="button"
                        >
                          {menuItem.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }
          if (isToolbarPopover(item)) {
            const isImport = item.popover.variant === "document.import";
            const isExport = item.popover.variant === "document.export";
            if (!isImport && !isExport) return null;
            return (
              <div key={item.id} ref={isExport ? exportButtonRef : importButtonRef} style={{ position: "relative" }}>
                <ToolbarButton
                  active={openPopover === (isExport ? "export" : "import")}
                  disabled={isImport && !props.app.isCommandEnabled("document.importReplaceCurrent")}
                  iconId={item.icon}
                  onClick={() => togglePopover(isExport ? "export" : "import")}
                  title={item.title}
                />
              </div>
            );
          }
          return null;
        })}

        {saveBadge ? <div className="kmind-zen-badge">{saveBadge}</div> : null}
      </div>

      <div className={["kmind-zen-bar", "kmind-zen-bar--left", zenMode ? "kmind-zen-bar--hidden" : ""].filter(Boolean).join(" ")}>
        {!readOnlyMode ? (
          <>
            <div ref={projectButtonRef} style={{ position: "relative" }}>
              <ToolbarButton
                active={openPopover === "project"}
                iconId="kmind-icon://builtin/ui/project"
                onClick={() => togglePopover("project")}
                title={t("appPage.floatingToolbar.project.title")}
              />
            </div>

            <div ref={historyButtonRef} style={{ position: "relative" }}>
              <ToolbarButton
                active={openPopover === "history"}
                iconId="kmind-icon://builtin/ui/history"
                onClick={() => togglePopover("history")}
                title={t("obsidian.history.title")}
              />
            </div>

            {leftRailToolbarItems.map((item) =>
              isToolbarButton(item) ? (
                <ToolbarButton
                  key={item.id}
                  active={isToolbarButtonActive(item.commandId)}
                  disabled={!props.app.isCommandEnabled(item.commandId, item.args)}
                  iconId={item.icon}
                  onClick={() => void props.app.dispatch(item.commandId, item.args).finally(() => props.app.focusCanvas())}
                  title={item.title}
                />
              ) : null,
            )}
          </>
        ) : null}
      </div>

      <div className={["kmind-zen-bar", "kmind-zen-bar--bottom", zenMode ? "kmind-zen-bar--hidden" : ""].filter(Boolean).join(" ")}>
        <div className="kmind-zen-tabs" title={t("appPage.floatingToolbar.maps.title")}>
          {projectMaps.length === 0 ? (
            <div className="kmind-zen-tabs__empty">
              {projectMapsLoading ? t("kmind.common.loading") : (activeMapTitle || activeId || t("appPage.floatingToolbar.maps.title"))}
            </div>
          ) : (
            projectMaps.map((item) => {
              const isCurrent = props.snapshot.documents.activeId === item.docId;
              const isRoot = item.docId === rootDocId;
              return (
                <button
                  key={item.docId}
                  className={["kmind-zen-btn", "kmind-zen-tab", isCurrent ? "kmind-zen-btn--active" : ""].filter(Boolean).join(" ")}
                  onClick={() => {
                    if (isCurrent) return;
                    void props.app.dispatch("submap.navigateTo", { docId: item.docId }).finally(() => props.app.focusCanvas());
                  }}
                  onContextMenu={(event) => {
                    if (readOnlyMode) return;
                    if (isRoot) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setOpenPopover(null);
                    const rootRect = rootRef.current?.getBoundingClientRect() ?? null;
                    const localX = rootRect ? event.clientX - rootRect.left : event.clientX;
                    const localY = rootRect ? event.clientY - rootRect.top : event.clientY;
                    const title = item.title || item.docId;
                    setTabMenuDraftTitle(title);
                    setTabMenu({ docId: item.docId, title, x: localX, y: localY, mode: "menu" });
                  }}
                  tabIndex={-1}
                  title={item.title}
                  type="button"
                >
                  <span className="kmind-zen-tab__label">{item.title || item.docId}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="kmind-zen-stats">
          {stats ? (
            <>
              <span>{t("appPage.floatingToolbar.stats.roots", { count: stats.rootCount })}</span>
              <span>{t("appPage.floatingToolbar.stats.nodes", { count: stats.nodeCount })}</span>
              <span>{t("appPage.floatingToolbar.stats.words", { count: stats.wordCount })}</span>
            </>
          ) : (
            <span>{t("kmind.common.emptyDash")}</span>
          )}
        </div>

        {bottomRightToolbarItems
          .filter((item) => isToolbarButton(item) && item.commandId !== "mindmap.zoomOut" && item.commandId !== "mindmap.zoomIn" && item.commandId !== "mindmap.fitView")
          .map((item) => {
            if (isToolbarButton(item)) {
              return (
                <div data-km-project-search-toggle={item.commandId === "project.search.toggle" ? "true" : undefined} key={item.id}>
                  <ToolbarButton
                    active={isToolbarButtonActive(item.commandId)}
                    disabled={!props.app.isCommandEnabled(item.commandId, item.args)}
                    iconId={item.icon}
                    onClick={() => {
                      if (item.commandId === "project.search.toggle") {
                        void (async () => {
                          const ok = await requestSetOpenPopover(null);
                          if (!ok) return;
                          void props.app.dispatch(item.commandId, item.args).finally(() => props.app.focusCanvas());
                        })();
                        return;
                      }
                      void props.app.dispatch(item.commandId, item.args).finally(() => props.app.focusCanvas());
                    }}
                    title={item.title}
                  />
                </div>
              );
            }
            return null;
          })}

        <div style={{ position: "relative" }}>
          <ToolbarButton active={openPopover === "minimap"} iconId="kmind-icon://builtin/ui/minimap" onClick={() => togglePopover("minimap")} title={t("appPage.floatingToolbar.minimap.title")} />
          {openPopover === "minimap" ? (
            <div className="kmind-zen-popover" style={{ right: 0, bottom: "calc(100% + 8px)", width: 320, overflowX: "hidden", overflowY: "auto" }}>
              <div className="kmind-zen-popover__header">{t("appPage.floatingToolbar.minimap.title")}</div>
              <div className="kmind-zen-popover__body">
                {minimapModel && minimapView ? (
                  <>
                    <svg
                      height={140}
                      onPointerCancel={(event) => {
                        if (minimapDragPointerIdRef.current !== event.pointerId) return;
                        minimapDragPointerIdRef.current = null;
                        minimapDragOffsetWorldRef.current = null;
                        setMinimapDragging(false);
                      }}
                      onPointerDown={(event) => {
                        if (!minimapView) return;
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.stopPropagation();
                        minimapDragPointerIdRef.current = event.pointerId;
                        minimapDragOffsetWorldRef.current = null;
                        try {
                          event.currentTarget.setPointerCapture(event.pointerId);
                        } catch {
                          // ignore
                        }
                        const rect = event.currentTarget.getBoundingClientRect();
                        if (!rect.width || !rect.height) return;
                        setMinimapDragging(true);
                        const localX = ((event.clientX - rect.left) / rect.width) * 280;
                        const localY = ((event.clientY - rect.top) / rect.height) * 140;
                        const point = { x: Math.max(0, Math.min(280, localX)), y: Math.max(0, Math.min(140, localY)) };
                        const worldPoint = minimapPointToWorldPoint(minimapView.transform, point);

                        const viewportRect = minimapView.viewportRect;
                        const viewBox = minimapView.viewBox;
                        if (viewportRect && viewBox) {
                          const hitPadding = 8;
                          const hit =
                            point.x >= viewportRect.x - hitPadding &&
                            point.x <= viewportRect.x + viewportRect.width + hitPadding &&
                            point.y >= viewportRect.y - hitPadding &&
                            point.y <= viewportRect.y + viewportRect.height + hitPadding;
                          if (hit) {
                            const centerX = viewBox.x + viewBox.width / 2;
                            const centerY = viewBox.y + viewBox.height / 2;
                            minimapDragOffsetWorldRef.current = { x: worldPoint.x - centerX, y: worldPoint.y - centerY };
                          }
                        }

                        const offset = minimapDragOffsetWorldRef.current ?? { x: 0, y: 0 };
                        scheduleMinimapPanTo({ x: worldPoint.x - offset.x, y: worldPoint.y - offset.y });
                      }}
                      onPointerMove={(event) => {
                        if (minimapDragPointerIdRef.current !== event.pointerId) return;
                        if (!minimapView) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        if (!rect.width || !rect.height) return;
                        const localX = ((event.clientX - rect.left) / rect.width) * 280;
                        const localY = ((event.clientY - rect.top) / rect.height) * 140;
                        const point = { x: Math.max(0, Math.min(280, localX)), y: Math.max(0, Math.min(140, localY)) };
                        const worldPoint = minimapPointToWorldPoint(minimapView.transform, point);
                        const offset = minimapDragOffsetWorldRef.current ?? { x: 0, y: 0 };
                        scheduleMinimapPanTo({ x: worldPoint.x - offset.x, y: worldPoint.y - offset.y });
                      }}
                      onPointerUp={(event) => {
                        if (minimapDragPointerIdRef.current !== event.pointerId) return;
                        minimapDragPointerIdRef.current = null;
                        minimapDragOffsetWorldRef.current = null;
                        setMinimapDragging(false);
                      }}
                      style={{ width: "100%", display: "block", cursor: minimapDragging ? "grabbing" : "grab", touchAction: "none" }}
                      viewBox="0 0 280 140"
                      width={280}
                    >
                      <rect
                        fill="rgba(148,163,184,0.08)"
                        height={140}
                        rx={14}
                        ry={14}
                        stroke="rgba(148,163,184,0.35)"
                        width={280}
                        x={0}
                        y={0}
                      />
                      <rect
                        fill="rgba(148,163,184,0.06)"
                        height={minimapView.contentRect.height}
                        rx={10}
                        ry={10}
                        stroke="rgba(148,163,184,0.35)"
                        strokeDasharray="4 4"
                        width={minimapView.contentRect.width}
                        x={minimapView.contentRect.x}
                        y={minimapView.contentRect.y}
                      />
                      {minimapView.viewportRect ? (
                        <rect
                          fill="rgba(59,130,246,0.12)"
                          height={minimapView.viewportRect.height}
                          rx={10}
                          ry={10}
                          stroke="rgba(59,130,246,0.85)"
                          strokeWidth={2}
                          width={minimapView.viewportRect.width}
                          x={minimapView.viewportRect.x}
                          y={minimapView.viewportRect.y}
                        />
                      ) : null}
                      {minimapModel.points.map((p) => {
                        const point = worldPointToMinimapPoint(minimapView.transform, { x: p.x, y: p.y });
                        const isRoot = p.kind === "node" && minimapView.rootSet.has(p.id);
                        const isSelected = minimapView.selectedId === p.id;
                        const radius = isRoot ? 3.2 : 2.2;
                        const fill = p.kind === "summary"
                          ? "rgba(16,185,129,0.75)"
                          : isRoot
                            ? "rgba(59,130,246,0.95)"
                            : "rgba(59,130,246,0.55)";
                        return (
                          <g key={`${p.kind}:${p.id}`}>
                            <title>{p.kind === "node" ? minimapView.resolveTitle(p.id) : t("appPage.floatingToolbar.minimap.tooltip.summary")}</title>
                            {p.kind === "summary" ? (
                              <rect fill={fill} height={radius * 2} rx={radius * 0.6} ry={radius * 0.6} width={radius * 2} x={point.x - radius} y={point.y - radius} />
                            ) : (
                              <circle cx={point.x} cy={point.y} fill={fill} r={radius} />
                            )}
                            {isSelected ? <circle cx={point.x} cy={point.y} fill="none" r={radius + 3.2} stroke="rgba(234,88,12,0.95)" strokeWidth={2} /> : null}
                          </g>
                        );
                      })}
                    </svg>
                    <div className="kmind-zen-subtle">
                      {t("appPage.floatingToolbar.minimap.hint.drag")}
                      {minimapModel.sampled ? ` • ${t("appPage.floatingToolbar.minimap.hint.sampled")}` : ""}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--kmind-zen-muted)" }}>{t("kmind.common.emptyDash")}</div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {bottomRightToolbarItems
          .filter((item) => isToolbarButton(item) && item.commandId === "mindmap.zoomOut")
          .map((item) =>
            isToolbarButton(item) ? (
              <ToolbarButton
                key={item.id}
                active={isToolbarButtonActive(item.commandId)}
                disabled={!props.app.isCommandEnabled(item.commandId, item.args)}
                iconId={item.icon}
                onClick={() => void props.app.dispatch(item.commandId, item.args).finally(() => props.app.focusCanvas())}
                title={item.title}
              />
            ) : null,
          )}
        <div className="kmind-zen-badge" title={t("appPage.floatingToolbar.zoom.title")}>
          {editingZoom ? (
            <input
              ref={zoomInputRef}
              className="kmind-zen-zoom-input"
              inputMode="numeric"
              onBlur={() => {
                const raw = Number.parseInt(draftZoom.trim(), 10);
                setEditingZoom(false);
                setDraftZoom("");
                if (!Number.isFinite(raw)) return;
                const clamped = Math.max(10, Math.min(400, raw));
                void props.app.dispatch("mindmap.zoomTo", { zoom: clamped / 100 }).finally(() => props.app.focusCanvas());
              }}
              onChange={(event) => {
                setDraftZoom(event.target.value.replace(/[^\\d]/g, ""));
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditingZoom(false);
                  setDraftZoom("");
                  return;
                }
                if (event.key !== "Enter") return;
                event.preventDefault();
                const raw = Number.parseInt(draftZoom.trim(), 10);
                setEditingZoom(false);
                setDraftZoom("");
                if (!Number.isFinite(raw)) return;
                const clamped = Math.max(10, Math.min(400, raw));
                void props.app.dispatch("mindmap.zoomTo", { zoom: clamped / 100 }).finally(() => props.app.focusCanvas());
              }}
              value={draftZoom}
            />
          ) : (
            <button
              className="kmind-zen-zoom-btn"
              onClick={() => {
                setEditingZoom(true);
                setDraftZoom(String(Math.round(zoom * 100)));
              }}
              onDoubleClick={() => {
                void props.app.dispatch("mindmap.resetZoom").finally(() => props.app.focusCanvas());
              }}
              tabIndex={-1}
              type="button"
            >
              {zoomLabel}
            </button>
          )}
        </div>
        {bottomRightToolbarItems
          .filter((item) => isToolbarButton(item) && item.commandId === "mindmap.zoomIn")
          .map((item) =>
            isToolbarButton(item) ? (
              <ToolbarButton
                key={item.id}
                active={isToolbarButtonActive(item.commandId)}
                disabled={!props.app.isCommandEnabled(item.commandId, item.args)}
                iconId={item.icon}
                onClick={() => void props.app.dispatch(item.commandId, item.args).finally(() => props.app.focusCanvas())}
                title={item.title}
              />
            ) : null,
          )}
        {bottomRightToolbarItems
          .filter((item) => isToolbarButton(item) && item.commandId === "mindmap.fitView")
          .map((item) =>
            isToolbarButton(item) ? (
              <ToolbarButton
                key={item.id}
                active={isToolbarButtonActive(item.commandId)}
                disabled={!props.app.isCommandEnabled(item.commandId, item.args)}
                iconId={item.icon}
                onClick={() => void props.app.dispatch(item.commandId, item.args).finally(() => props.app.focusCanvas())}
                title={item.title}
              />
            ) : null,
          )}
        {bottomRightToolbarItems
          .filter((item) => isToolbarPopover(item) && item.popover.variant === "app.about")
          .map((item) =>
            isToolbarPopover(item) ? (
              <div key={item.id} style={{ position: "relative" }}>
                <ToolbarButton active={openPopover === "about"} iconId={item.icon} onClick={() => togglePopover("about")} title={item.title} />
                {openPopover === "about" ? (
                  <div className="kmind-zen-popover" style={{ right: 0, bottom: "calc(100% + 8px)", width: 320, overflowX: "hidden", overflowY: "auto" }}>
                    <AppAboutPopover
                      app={props.app}
                      onOpenUpdateDialog={props.onOpenUpdateDialog
                        ? () => {
                            void requestSetOpenPopover(null);
                            props.onOpenUpdateDialog?.();
                          }
                        : undefined}
                    />
                  </div>
                ) : null}
              </div>
            ) : null,
          )}
      </div>

      {openPopover === "export" ? (
        <div className="kmind-zen-popover" style={{ ...exportPopoverStyle, overflowX: "hidden" }}>
          <DocumentExportPopover app={props.app} onClose={() => void requestSetOpenPopover(null)} snapshot={props.snapshot} />
        </div>
      ) : null}

      {openPopover === "import" ? (
        <div className="kmind-zen-popover" style={{ ...importPopoverStyle, overflowX: "hidden" }}>
          <DocumentImportPopover app={props.app} onClose={() => void requestSetOpenPopover(null)} snapshot={props.snapshot} />
        </div>
      ) : null}

      {openPopover === "project" ? (
        <div className="kmind-zen-popover" style={{ ...projectPopoverStyle, overflowX: "hidden" }}>
          {renderProjectSettingsPopover()}
        </div>
      ) : null}

      {openPopover === "history" ? (
        <div className="kmind-zen-popover" style={{ ...historyPopoverStyle, overflowX: "hidden" }}>
          <HistoryPopover
            app={props.app}
            file={props.file}
            hostApp={props.hostApp}
            preview={props.preview}
            snapshot={props.snapshot}
            onClose={() => void requestSetOpenPopover(null)}
          />
        </div>
      ) : null}

      <ProjectSearchPopover
        app={props.app}
        snapshot={props.snapshot}
        open={projectSearch.open}
        requestId={projectSearch.requestId}
        onClose={() => {
          void props.app.dispatch("project.search.close").finally(() => props.app.focusCanvas());
        }}
      />

      {tabMenu ? (
        <div
          ref={tabMenuRef}
          className="kmind-zen-popover"
          style={{
            position: "absolute",
            left: tabMenu.x,
            top: tabMenu.y,
            width: tabMenu.mode === "menu" ? 240 : 320,
            minWidth: 0,
            maxHeight: 220,
            maxWidth: "calc(100% - 20px)",
            overflowX: "hidden",
            overflowY: "auto",
          }}
        >
          <div className="kmind-zen-popover__header" title={tabMenu.title}>
            {tabMenu.mode === "menu" ? (
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tabMenu.title}</span>
            ) : (
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("app.command.submap.rename")}</span>
            )}
          </div>
          <div className="kmind-zen-popover__body">
            {tabMenu.mode === "menu" ? (
              <>
                <button
                  className="kmind-zen-row"
                  onClick={() => {
                    setTabMenu((prev) => (prev ? { ...prev, mode: "rename" } : prev));
                  }}
                  tabIndex={-1}
                  type="button"
                >
                  <span className="kmind-zen-row__title">{t("app.command.submap.rename")}</span>
                </button>
                <button
                  className="kmind-zen-row"
                  onClick={() => setTabMenu((prev) => (prev ? { ...prev, mode: "delete" } : prev))}
                  tabIndex={-1}
                  type="button"
                >
                  <span className="kmind-zen-row__title">{t("app.command.submap.delete")}</span>
                </button>
              </>
            ) : null}

            {tabMenu.mode === "rename" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  ref={tabMenuInputRef}
                  className="kmind-zen-input"
                  value={tabMenuDraftTitle}
                  onChange={(e) => setTabMenuDraftTitle(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setTabMenu((prev) => (prev ? { ...prev, mode: "menu" } : prev));
                      props.app.focusCanvas();
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const title = tabMenuDraftTitle.trim();
                      if (title) {
                        void props.app.dispatch("submap.rename", { docId: tabMenu.docId, title }).finally(() => props.app.focusCanvas());
                      }
                      setTabMenu(null);
                    }
                  }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button className="kmind-zen-btn" onClick={() => setTabMenu((prev) => (prev ? { ...prev, mode: "menu" } : prev))} type="button">
                    {t("kmind.common.cancel")}
                  </button>
                  <button
                    className="kmind-zen-btn kmind-zen-btn--primary"
                    onClick={() => {
                      const title = tabMenuDraftTitle.trim();
                      if (title) {
                        void props.app.dispatch("submap.rename", { docId: tabMenu.docId, title }).finally(() => props.app.focusCanvas());
                      }
                      setTabMenu(null);
                    }}
                    type="button"
                  >
                    {t("kmind.common.ok")}
                  </button>
                </div>
              </div>
            ) : null}

            {tabMenu.mode === "delete" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, opacity: 0.85 }}>{t("app.dialog.submap.delete.confirm", { title: tabMenu.title })}</div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button className="kmind-zen-btn" onClick={() => setTabMenu((prev) => (prev ? { ...prev, mode: "menu" } : prev))} type="button">
                    {t("kmind.common.cancel")}
                  </button>
                  <button
                    className="kmind-zen-btn kmind-zen-btn--primary"
                    onClick={() => {
                      void props.app.dispatch("submap.delete", { docId: tabMenu.docId }).finally(() => props.app.focusCanvas());
                      setTabMenu(null);
                    }}
                    type="button"
                  >
                    {t("app.command.submap.delete")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
