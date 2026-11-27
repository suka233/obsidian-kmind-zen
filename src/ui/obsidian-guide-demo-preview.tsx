import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveThemePreset } from "@kmind/app";
import {
  type Bounds,
  MindMapCore,
  createDocument,
  createHostSyncedDocumentThemeState,
  DefaultIdGenerator,
  type EdgeRouteType,
  type ThemeDefinition,
  type ThemeRef,
} from "@kmind/core";
import { MindMapCanvas, type MindMapCanvasApi, type MindMapMinimapModel } from "@kmind/editor-react";

type TFn = (key: string, params?: Record<string, unknown> | undefined) => string;

type DemoCtx = {
  rootId: string;
  nodes: Record<string, string>;
};

type DemoRuntime = {
  core: MindMapCore;
  ctx: DemoCtx;
};

type DemoStep = {
  id: string;
  title: string;
  delayMs: number;
  run: (runtime: DemoRuntime) => void;
};

const DEMO_THEME_PRESETS = [
  "kmind-material-3-slate",
  "kmind-material-3-rounded-orthogonal-ocean",
  "kmind-material-3-rounded-orthogonal-forest",
  "kmind-material-3-rounded-orthogonal-violet",
  "kmind-material-3-rounded-orthogonal-citrus",
  "kmind-material-3-rounded-orthogonal-rose",
  "kmind-material-3-rounded-orthogonal-aqua",
] as const;

const DEMO_EDGE_ROUTES: EdgeRouteType[] = [
  "orthogonal-rounded",
  "cubic",
  "straight",
  "tapered",
  "center-quadratic",
  "orthogonal",
];

function deepClone<T>(value: T): T {
  const clone = (globalThis as unknown as { structuredClone?: ((v: unknown) => unknown) | undefined }).structuredClone;
  if (typeof clone === "function") return clone(value) as T;
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeInlineThemeRef(theme: ThemeDefinition): ThemeRef {
  return { source: "inline", value: theme };
}

function createDemoRuntime(rootText: string): DemoRuntime {
  const doc = createDocument(new DefaultIdGenerator(), { rootText });

  const slatePreset = resolveThemePreset(DEMO_THEME_PRESETS[0]);
  if (slatePreset) {
    doc.theme = createHostSyncedDocumentThemeState({ source: "inline", value: deepClone(slatePreset.theme) });
  }

  const core = new MindMapCore({ id: "kmind-obsidian-guide-demo-v1", initialDocument: doc, maxHistory: 80 });
  const rootId = core.getState().document.roots[0] ?? "root";
  core.dispatch({ type: "set_theme_root_edge_route", payload: { rootId, routeType: DEMO_EDGE_ROUTES[0] } });

  return {
    core,
    ctx: { rootId, nodes: {} },
  };
}

function buildDemoSteps(t: TFn): DemoStep[] {
  const steps: DemoStep[] = [];

  const addRootChild = (key: string, text: string): DemoStep["run"] => (runtime) => {
    const res = runtime.core.dispatch({ type: "add_child", payload: { parentId: runtime.ctx.rootId, node: { text } } });
    if (res.ok && "createdNodeId" in res && res.createdNodeId) runtime.ctx.nodes[key] = res.createdNodeId;
  };

  const addChild = (parentKey: string, key: string, text: string): DemoStep["run"] => (runtime) => {
    const parentId = runtime.ctx.nodes[parentKey];
    if (!parentId) return;
    const res = runtime.core.dispatch({ type: "add_child", payload: { parentId, node: { text } } });
    if (res.ok && "createdNodeId" in res && res.createdNodeId) runtime.ctx.nodes[key] = res.createdNodeId;
  };

  const copy = {
    vaultFlow: t("obsidian.guide.demo.node.vaultFlow"),
    newMap: t("obsidian.guide.demo.node.newMap"),
    commandPalette: t("obsidian.guide.demo.node.commandPalette"),
    folderMenu: t("obsidian.guide.demo.node.folderMenu"),
    localFile: t("obsidian.guide.demo.node.localFile"),
    reopenFile: t("obsidian.guide.demo.node.reopenFile"),
    autoSave: t("obsidian.guide.demo.node.autoSave"),
    zenMode: t("obsidian.guide.demo.node.zenMode"),
    history: t("obsidian.guide.demo.node.history"),
    export: t("obsidian.guide.demo.node.export"),
  };

  const titles = [
    copy.vaultFlow,
    copy.newMap,
    copy.commandPalette,
    copy.folderMenu,
    copy.localFile,
    copy.reopenFile,
    copy.autoSave,
    copy.zenMode,
    copy.history,
    copy.export,
  ];

  const nodeRuns: Array<DemoStep["run"]> = [
    addRootChild("vaultFlow", copy.vaultFlow),
    addChild("vaultFlow", "newMap", copy.newMap),
    addChild("newMap", "commandPalette", copy.commandPalette),
    addChild("newMap", "folderMenu", copy.folderMenu),
    addRootChild("localFile", copy.localFile),
    addChild("localFile", "reopenFile", copy.reopenFile),
    addChild("localFile", "autoSave", copy.autoSave),
    addRootChild("zenMode", copy.zenMode),
    addChild("zenMode", "history", copy.history),
    addChild("zenMode", "export", copy.export),
  ];

  for (let index = 0; index < nodeRuns.length; index += 1) {
    const themePresetId = DEMO_THEME_PRESETS[index % DEMO_THEME_PRESETS.length];
    const edgeRouteType = DEMO_EDGE_ROUTES[index % DEMO_EDGE_ROUTES.length];

    steps.push({
      id: `step-${index + 1}`,
      title: titles[index] ?? `Step ${index + 1}`,
      delayMs: 2350,
      run: (runtime) => {
        const preset = resolveThemePreset(themePresetId);
        if (preset) {
          runtime.core.dispatch({ type: "set_document_theme", payload: { theme: makeInlineThemeRef(deepClone(preset.theme)) } });
        }
        runtime.core.dispatch({ type: "set_theme_root_edge_route", payload: { rootId: runtime.ctx.rootId, routeType: edgeRouteType } });
        nodeRuns[index]?.(runtime);
      },
    });
  }

  return steps;
}

function ReplayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 12a9 9 0 0 0 9 9c2.39 0 4.68-.94 6.4-2.6l-1.5-1.5A6.7 6.7 0 0 1 11 19c-6.24 0-9.36-7.54-4.95-11.95S18 5.77 18 12h-3l4 4h.1l3.9-4h-3a9 9 0 0 0-18 0" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

export function ObsidianGuideDemoPreview(props: { t: TFn }) {
  const canvasApiRef = useRef<MindMapCanvasApi | null>(null);
  const rootText = props.t("obsidian.guide.step.welcome.demoRoot");
  const steps = useMemo(() => buildDemoSteps(props.t), [props.t]);
  const [uiHover, setUiHover] = useState(false);
  const [uiAutoHide, setUiAutoHide] = useState(false);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setUiAutoHide(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  const fitTimersRef = useRef<number[]>([]);
  const clearFitTimers = useCallback(() => {
    for (const id of fitTimersRef.current) {
      try {
        clearTimeout(id);
      } catch {
        // ignore
      }
    }
    fitTimersRef.current = [];
  }, []);

  const lastViewportRef = useRef<{ width: number; height: number } | null>(null);
  const lastBoundsRef = useRef<Bounds | null>(null);
  const lastAutoFitRef = useRef<{ zoom: number; centerX: number; centerY: number; viewportWidth: number; viewportHeight: number } | null>(null);

  const fitToBoundsNoZoomIn = useCallback(() => {
    const bounds = lastBoundsRef.current;
    const viewport = lastViewportRef.current;
    if (!bounds || !viewport || viewport.width <= 1 || viewport.height <= 1) return;

    const padding = 80;
    const targetWidth = Math.max(1, bounds.width + padding * 2);
    const targetHeight = Math.max(1, bounds.height + padding * 2);
    const fitZoom = Math.min(4, Math.max(0.1, Math.min(viewport.width / targetWidth, viewport.height / targetHeight)));
    const desiredZoom = Math.min(1, fitZoom);
    const centerX = bounds.minX + bounds.width / 2;
    const centerY = bounds.minY + bounds.height / 2;

    const previous = lastAutoFitRef.current;
    if (
      previous &&
      previous.viewportWidth === viewport.width &&
      previous.viewportHeight === viewport.height &&
      Math.abs(previous.zoom - desiredZoom) < 0.0005 &&
      Math.abs(previous.centerX - centerX) < 0.5 &&
      Math.abs(previous.centerY - centerY) < 0.5
    ) {
      return;
    }

    lastAutoFitRef.current = {
      zoom: desiredZoom,
      centerX,
      centerY,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    };

    try {
      canvasApiRef.current?.zoomTo(desiredZoom);
      canvasApiRef.current?.panTo({ x: centerX, y: centerY });
    } catch {
      // ignore
    }
  }, []);

  const scheduleFitView = useCallback(() => {
    clearFitTimers();
    const delays = [0, 180, 420, 720];
    for (const delay of delays) {
      const id = window.setTimeout(() => {
        fitTimersRef.current = fitTimersRef.current.filter((item) => item !== id);
        try {
          fitToBoundsNoZoomIn();
        } catch {
          // ignore
        }
      }, delay);
      fitTimersRef.current.push(id);
    }
  }, [clearFitTimers, fitToBoundsNoZoomIn]);

  const [core, setCore] = useState(() => {
    const runtime = createDemoRuntime(rootText);
    if (steps.length > 0) steps[0]?.run(runtime);
    return runtime.core;
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [pausedReason, setPausedReason] = useState<"interaction" | "control" | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [isTransitionCoverVisible, setIsTransitionCoverVisible] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const revealedRef = useRef(revealed);
  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);

  const bootedRef = useRef(false);
  const revealTimerRef = useRef<number | null>(null);
  const clearRevealTimer = useCallback(() => {
    if (!revealTimerRef.current) return;
    try {
      clearTimeout(revealTimerRef.current);
    } catch {
      // ignore
    }
    revealTimerRef.current = null;
  }, []);

  const playTimerRef = useRef<number | null>(null);
  const clearPlayTimer = useCallback(() => {
    if (!playTimerRef.current) return;
    try {
      clearTimeout(playTimerRef.current);
    } catch {
      // ignore
    }
    playTimerRef.current = null;
  }, []);

  const dirtyByInteractionRef = useRef(false);
  const transitionTimersRef = useRef<number[]>([]);
  const clearTransitionTimers = useCallback(() => {
    for (const id of transitionTimersRef.current) {
      try {
        clearTimeout(id);
      } catch {
        // ignore
      }
    }
    transitionTimersRef.current = [];
  }, []);

  const rebuildToStep = useCallback((target: number) => {
    clearPlayTimer();
    const nextIndex = Math.min(Math.max(0, target), steps.length - 1);
    const runtime = createDemoRuntime(rootText);
    for (let i = 0; i <= nextIndex; i += 1) {
      steps[i]?.run(runtime);
    }
    lastBoundsRef.current = null;
    lastAutoFitRef.current = null;
    setCore(runtime.core);
    setStepIndex(nextIndex);
    window.setTimeout(() => {
      try {
        canvasApiRef.current?.focus();
      } catch {
        // ignore
      }
      scheduleFitView();
    }, 0);
  }, [clearPlayTimer, rootText, scheduleFitView, steps, fitToBoundsNoZoomIn]);

  const transitionToStep = useCallback((target: number) => {
    clearPlayTimer();
    clearFitTimers();
    clearTransitionTimers();
    if (prefersReducedMotion || !revealedRef.current) {
      setIsTransitionCoverVisible(false);
      setIsTransitioning(false);
      rebuildToStep(target);
      return;
    }

    setIsTransitioning(true);
    setIsTransitionCoverVisible(true);
    const fadeOutMs = 240;
    const fadeInMs = 280;
    const fadeDurationMs = 220;

    transitionTimersRef.current.push(window.setTimeout(() => rebuildToStep(target), fadeOutMs));
    transitionTimersRef.current.push(window.setTimeout(() => setIsTransitionCoverVisible(false), fadeOutMs + fadeInMs));
    transitionTimersRef.current.push(window.setTimeout(() => setIsTransitioning(false), fadeOutMs + fadeInMs + fadeDurationMs));
  }, [clearFitTimers, clearPlayTimer, clearTransitionTimers, prefersReducedMotion, rebuildToStep]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const pauseIfTargetInside = (event: Event) => {
      if (!isPlayingRef.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!el.contains(target)) return;
      if (target instanceof Element && target.closest("[data-km-guide-demo-control='true']")) return;
      dirtyByInteractionRef.current = true;
      clearFitTimers();
      clearPlayTimer();
      setPausedReason("interaction");
      setIsPlaying(false);
    };

    const onPointerDownCapture = (event: PointerEvent) => pauseIfTargetInside(event);
    const onWheelCapture = (event: WheelEvent) => pauseIfTargetInside(event);
    const onKeyDownCapture = (event: KeyboardEvent) => pauseIfTargetInside(event);

    window.addEventListener("pointerdown", onPointerDownCapture, { capture: true });
    window.addEventListener("wheel", onWheelCapture, { capture: true, passive: true });
    window.addEventListener("keydown", onKeyDownCapture, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDownCapture, { capture: true } as unknown as AddEventListenerOptions);
      window.removeEventListener("wheel", onWheelCapture, { capture: true } as unknown as AddEventListenerOptions);
      window.removeEventListener("keydown", onKeyDownCapture, { capture: true } as unknown as AddEventListenerOptions);
    };
  }, [clearFitTimers, clearPlayTimer]);

  useEffect(() => {
    return () => {
      clearFitTimers();
      clearRevealTimer();
      clearPlayTimer();
      clearTransitionTimers();
    };
  }, [clearFitTimers, clearPlayTimer, clearRevealTimer, clearTransitionTimers]);

  useEffect(() => {
    if (!revealed) return;
    clearPlayTimer();
    if (!isPlaying || steps.length === 0) return;

    const isLast = stepIndex >= steps.length - 1;
    const baseDelay = steps[stepIndex]?.delayMs ?? 1800;
    const delay = isLast ? Math.max(1800, baseDelay + 500) : baseDelay;
    playTimerRef.current = window.setTimeout(() => {
      playTimerRef.current = null;
      transitionToStep(isLast ? 0 : stepIndex + 1);
    }, delay);

    return () => clearPlayTimer();
  }, [clearPlayTimer, isPlaying, revealed, stepIndex, steps, transitionToStep]);

  const stepsCount = steps.length;
  const currentStepTitle = steps[stepIndex]?.title ?? rootText;
  const showOverlayUi = revealed && (!uiAutoHide || uiHover);

  return (
    <div className="kmind-zen-guide-demoPreview">
      <div className="kmind-zen-guide-demoPreview__frame">
        <div
          ref={containerRef}
          className={isTransitioning ? "kmind-zen-guide-liveDemo kmind-zen-guide-liveDemo--transitioning" : "kmind-zen-guide-liveDemo"}
          onMouseEnter={() => setUiHover(true)}
          onMouseLeave={() => setUiHover(false)}
        >
          <MindMapCanvas
            canvasApiRef={canvasApiRef}
            className={[
              "kmind-zen-guide-liveDemo__canvas",
              revealed ? "kmind-zen-guide-liveDemo__canvas--revealed" : "kmind-zen-guide-liveDemo__canvas--hidden",
              isTransitioning ? "kmind-zen-guide-liveDemo__canvas--transitioning" : "",
            ].join(" ")}
            core={core}
            documentId={core.id}
            initialSelection="none"
            textEditor="plain"
            editingLayoutMode="stable"
            dragGhostMode="light"
            onCameraChange={(camera) => {
              const viewport = camera.viewport;
              if (viewport && viewport.width > 1 && viewport.height > 1) {
                lastViewportRef.current = viewport;
              }
              if (bootedRef.current || !viewport || viewport.width <= 1 || viewport.height <= 1) return;
              bootedRef.current = true;
              try {
                canvasApiRef.current?.focus();
              } catch {
                // ignore
              }
              scheduleFitView();
              clearRevealTimer();
              revealTimerRef.current = window.setTimeout(() => {
                revealTimerRef.current = null;
                if (revealedRef.current) return;
                revealedRef.current = true;
                setRevealed(true);
              }, 220);
            }}
            onMinimapChange={(model: MindMapMinimapModel) => {
              lastBoundsRef.current = model.bounds;
            }}
            interaction={{
              collapseToggleVisibility: "hover",
              blankDoubleClickAction: "add-root",
              smartPaste: false,
              showDetachedRootHint: false,
              readOnly: false,
            }}
          />

          <div
            aria-hidden="true"
            className={[
              "kmind-zen-guide-liveDemo__cover",
              isTransitionCoverVisible ? "kmind-zen-guide-liveDemo__cover--visible" : "",
            ].join(" ")}
          />

          <div className={showOverlayUi ? "kmind-zen-guide-liveDemo__top" : "kmind-zen-guide-liveDemo__top kmind-zen-guide-liveDemo__top--hidden"}>
            <div className={showOverlayUi ? "kmind-zen-guide-liveDemo__status" : "kmind-zen-guide-liveDemo__status kmind-zen-guide-liveDemo__status--inactive"}>
              <div className="kmind-zen-guide-liveDemo__statusTitle">
                {isPlaying
                  ? currentStepTitle
                  : (stepIndex >= stepsCount - 1 ? props.t("obsidian.guide.demo.status.finished") : props.t("obsidian.guide.demo.status.paused"))}
              </div>
              <div className="kmind-zen-guide-liveDemo__statusMeta">
                {isPlaying
                  ? props.t("obsidian.guide.demo.hint.interaction")
                  : (pausedReason === "interaction" ? props.t("obsidian.guide.demo.status.resumeResets") : props.t("obsidian.guide.demo.caption"))}
              </div>
              <div className={showOverlayUi ? "kmind-zen-guide-liveDemo__progress" : "kmind-zen-guide-liveDemo__progress kmind-zen-guide-liveDemo__progress--inactive"} data-km-guide-demo-control="true">
                {steps.map((step, idx) => (
                  <button
                    key={step.id}
                    type="button"
                    className={
                      idx < stepIndex
                        ? "kmind-zen-guide-liveDemo__progressBtn kmind-zen-guide-liveDemo__progressBtn--complete"
                        : idx === stepIndex
                          ? "kmind-zen-guide-liveDemo__progressBtn kmind-zen-guide-liveDemo__progressBtn--active"
                          : "kmind-zen-guide-liveDemo__progressBtn"
                    }
                    title={step.title}
                    onClick={() => {
                      dirtyByInteractionRef.current = false;
                      setPausedReason("control");
                      setIsPlaying(false);
                      transitionToStep(idx);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className={showOverlayUi ? "kmind-zen-guide-liveDemo__bottom" : "kmind-zen-guide-liveDemo__bottom kmind-zen-guide-liveDemo__bottom--hidden"}>
            <div className={showOverlayUi ? "kmind-zen-guide-liveDemo__controls" : "kmind-zen-guide-liveDemo__controls kmind-zen-guide-liveDemo__controls--inactive"} data-km-guide-demo-control="true">
              <button
                type="button"
                className="kmind-zen-guide-liveDemo__controlBtn"
                title={props.t("obsidian.guide.demo.control.replay")}
                onClick={() => {
                  dirtyByInteractionRef.current = false;
                  setPausedReason(null);
                  setIsPlaying(true);
                  transitionToStep(0);
                }}
              >
                <ReplayIcon />
              </button>

              <button
                type="button"
                className="kmind-zen-guide-liveDemo__controlBtn"
                title={props.t("obsidian.guide.demo.control.prev")}
                disabled={stepIndex <= 0}
                onClick={() => {
                  dirtyByInteractionRef.current = false;
                  setPausedReason("control");
                  setIsPlaying(false);
                  transitionToStep(stepIndex - 1);
                }}
              >
                <PrevIcon />
              </button>

              <button
                type="button"
                className="kmind-zen-guide-liveDemo__controlBtn kmind-zen-guide-liveDemo__controlBtn--primary"
                title={isPlaying ? props.t("obsidian.guide.demo.control.pause") : props.t("obsidian.guide.demo.control.play")}
                onClick={() => {
                  if (isPlaying) {
                    setPausedReason("control");
                    setIsPlaying(false);
                    return;
                  }
                  if (dirtyByInteractionRef.current) {
                    dirtyByInteractionRef.current = false;
                    transitionToStep(stepIndex);
                  } else if (stepIndex >= stepsCount - 1) {
                    transitionToStep(0);
                  }
                  setPausedReason(null);
                  setIsPlaying(true);
                }}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>

              <button
                type="button"
                className="kmind-zen-guide-liveDemo__controlBtn"
                title={props.t("obsidian.guide.demo.control.next")}
                disabled={stepIndex >= stepsCount - 1}
                onClick={() => {
                  dirtyByInteractionRef.current = false;
                  setPausedReason("control");
                  setIsPlaying(false);
                  transitionToStep(stepIndex + 1);
                }}
              >
                <NextIcon />
              </button>
            </div>

            <div className={showOverlayUi ? "kmind-zen-guide-liveDemo__hint" : "kmind-zen-guide-liveDemo__hint kmind-zen-guide-liveDemo__hint--inactive"}>
              {props.t("obsidian.guide.demo.caption")}
            </div>
          </div>

          {!revealed ? (
            <div className="kmind-zen-guide-liveDemo__loading">
              <div className="kmind-zen-guide-liveDemo__spinner" />
              <div className="kmind-zen-guide-liveDemo__loadingText">{props.t("obsidian.guide.demo.loading")}</div>
            </div>
          ) : null}
        </div>
      </div>

      <p className="kmind-zen-guide-demoPreview__caption">{props.t("obsidian.guide.demo.caption")}</p>
    </div>
  );
}
