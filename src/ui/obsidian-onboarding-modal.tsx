import { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Modal, type App } from "obsidian";

import { ObsidianGuideDemoPreview } from "./obsidian-guide-demo-preview";

type TFn = (key: string, params?: Record<string, unknown> | undefined) => string;

type GuideStep = {
  id: string;
  titleKey: string;
  eyebrowKey: string;
  descKey: string;
  mediaSrc?: string | undefined;
  mediaAltKey?: string | undefined;
  callouts?: GuideCallout[] | undefined;
  kind: "welcome" | "media" | "follow";
};

type GuideCallout = {
  titleKey: string;
  descKey: string;
};

type GuideMediaMap = {
  commandPalette: string;
  folderMenu: string;
  openFile: string;
  zen: string;
};

type OpenOnboardingArgs = {
  app: App;
  t: TFn;
  iconSvg: string;
  media: GuideMediaMap;
  onClose?: (() => void) | undefined;
};

const GUIDE_STYLE_ID = "kmind-zen-obsidian-guide-style";
const GUIDE_SITE_URL = "https://kmind.app";
const GUIDE_SIYUAN_URL = "https://kmind.app/siyuan-plugin";

function ensureGuideStyles(): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(GUIDE_STYLE_ID) as HTMLStyleElement | null;
  const style = existing ?? document.createElement("style");
  style.id = GUIDE_STYLE_ID;
  style.textContent = `
.kmind-zen-guide-modal-shell .modal-title,
.kmind-zen-guide-modal-shell .modal-close-button{display:none;}
.kmind-zen-guide-modal-shell .modal-content{padding:0;overflow:hidden;}
.kmind-zen-guide-host{display:flex;min-height:min(700px,calc(100vh - 120px));}
.kmind-zen-guide-root{
  display:flex;
  flex:1 1 auto;
  min-height:min(700px,calc(100vh - 120px));
  font-family:var(--font-interface,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
  color:var(--text-normal,#0f172a);
  --km-guide-text: var(--text-normal, #0f172a);
  --km-guide-muted: var(--text-muted, #64748b);
  --km-guide-bg: var(--background-primary, #ffffff);
  --km-guide-surface: color-mix(in srgb, var(--background-secondary, #f8fafc) 84%, transparent);
  --km-guide-surface-light: color-mix(in srgb, var(--background-modifier-hover, rgba(148,163,184,.12)) 58%, transparent);
  --km-guide-surface-lighter: color-mix(in srgb, var(--background-modifier-hover, rgba(148,163,184,.18)) 82%, transparent);
  --km-guide-border: color-mix(in srgb, var(--background-modifier-border, rgba(148,163,184,.35)) 82%, transparent);
  --km-guide-primary: var(--interactive-accent, #3b82f6);
  --km-guide-on-primary: var(--text-on-accent, #ffffff);
  --km-guide-shadow-strong: 0 40px 140px rgba(2, 6, 23, .18);
  --km-guide-shadow-soft: 0 16px 36px rgba(2, 6, 23, .10);
  --km-guide-shadow-accent: 0 10px 24px color-mix(in srgb, var(--interactive-accent, #3b82f6) 24%, transparent);
  --km-guide-glass: color-mix(in srgb, var(--km-guide-bg) 84%, transparent);
  --km-guide-glass-strong: color-mix(in srgb, var(--km-guide-bg) 92%, transparent);
  --km-guide-fill-strong: color-mix(in srgb, var(--km-guide-bg) 84%, var(--km-guide-surface-light));
  --km-guide-accent-fill: color-mix(in srgb, var(--km-guide-primary) 14%, var(--km-guide-bg));
  --km-guide-cool-glow: color-mix(in srgb, var(--km-guide-primary) 14%, transparent);
  --km-guide-warm-glow: rgba(251,146,60,.12);
}
.theme-dark .kmind-zen-guide-root{
  --km-guide-shadow-strong: 0 40px 140px rgba(0, 0, 0, .38);
  --km-guide-shadow-soft: 0 16px 36px rgba(0, 0, 0, .24);
  --km-guide-warm-glow: rgba(251,146,60,.16);
}
.kmind-zen-guide-panel{
  position:relative;
  display:flex;
  flex:1 1 auto;
  min-height:0;
  flex-direction:column;
  overflow:hidden;
  border-radius:28px;
  border:1px solid var(--km-guide-border);
  background:
    linear-gradient(140deg, color-mix(in srgb, var(--km-guide-bg) 92%, transparent), color-mix(in srgb, var(--km-guide-bg) 76%, var(--km-guide-surface-light)) 48%, color-mix(in srgb, var(--km-guide-bg) 68%, var(--km-guide-surface))),
    radial-gradient(circle at top right, var(--km-guide-cool-glow), transparent 34%),
    radial-gradient(circle at left bottom, var(--km-guide-warm-glow), transparent 30%);
  box-shadow:var(--km-guide-shadow-strong);
  color:var(--km-guide-text);
}
.kmind-zen-guide-panel__grain{
  position:absolute;
  inset:0;
  opacity:.05;
  mix-blend-mode:overlay;
  background-image:radial-gradient(circle at 1px 1px,currentColor .75px,transparent 0);
  background-size:12px 12px;
  pointer-events:none;
}
.kmind-zen-guide-header{
  position:relative;
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:18px;
  padding:20px 22px 16px;
  border-bottom:1px solid var(--km-guide-border);
}
.kmind-zen-guide-brand{display:flex;align-items:flex-start;gap:16px;min-width:0;}
.kmind-zen-guide-brand__icon{
  width:44px;
  height:44px;
  flex:0 0 auto;
  display:flex;
  align-items:center;
  justify-content:center;
  border-radius:15px;
  border:1px solid var(--km-guide-border);
  background:linear-gradient(145deg, color-mix(in srgb, var(--km-guide-primary) 14%, var(--km-guide-bg)), color-mix(in srgb, var(--km-guide-warm-glow) 100%, var(--km-guide-bg)));
  box-shadow:inset 0 1px 0 color-mix(in srgb, var(--km-guide-bg) 40%, transparent);
}
.kmind-zen-guide-brand__icon svg{width:28px;height:28px;display:block;}
.kmind-zen-guide-brand__copy{min-width:0;}
.kmind-zen-guide-brand__eyebrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px;}
.kmind-zen-guide-chip,
.kmind-zen-guide-stepdot,
.kmind-zen-guide-icon-btn,
.kmind-zen-guide-btn,
.kmind-zen-guide-linkcard,
.kmind-zen-guide-callout,
.kmind-zen-guide-media__caption,
.kmind-zen-guide-liveDemo__status,
.kmind-zen-guide-liveDemo__controls,
.kmind-zen-guide-liveDemo__controlBtn,
.kmind-zen-guide-liveDemo__hint{
  color:var(--km-guide-text);
  border:1px solid var(--km-guide-border);
  background:var(--km-guide-glass);
  box-shadow:inset 0 1px 0 color-mix(in srgb, var(--km-guide-bg) 38%, transparent), var(--km-guide-shadow-soft);
}
.kmind-zen-guide-chip{
  display:inline-flex;
  align-items:center;
  height:24px;
  padding:0 10px;
  border-radius:999px;
  font-size:11px;
  font-weight:600;
  letter-spacing:.08em;
  text-transform:uppercase;
}
.kmind-zen-guide-chip--accent,
.kmind-zen-guide-stepdot--active{
  background:var(--km-guide-accent-fill);
  border-color:color-mix(in srgb, var(--km-guide-primary) 22%, transparent);
  color:var(--km-guide-primary);
}
.kmind-zen-guide-title{margin:0;font-size:22px;line-height:1.1;font-weight:720;letter-spacing:-.02em;}
.kmind-zen-guide-subtitle{margin:8px 0 0;font-size:13px;line-height:1.55;color:var(--km-guide-muted);}
.kmind-zen-guide-header__actions{display:flex;align-items:center;gap:8px;flex:0 0 auto;}
.kmind-zen-guide-icon-btn{
  appearance:none;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:38px;
  height:38px;
  border-radius:13px;
  cursor:pointer;
  transition:transform .18s ease,background-color .18s ease;
}
.kmind-zen-guide-icon-btn:hover{transform:translateY(-1px);background:var(--km-guide-fill-strong);}
.kmind-zen-guide-icon-btn:active{transform:translateY(0);}
.kmind-zen-guide-icon-btn svg{width:18px;height:18px;display:block;}
.kmind-zen-guide-body{
  display:grid;
  grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr);
  gap:0;
  min-height:0;
  flex:1 1 auto;
}
.kmind-zen-guide-stage{
  position:relative;
  display:flex;
  align-items:stretch;
  min-height:0;
  padding:22px 0 22px 22px;
  animation:kmindGuideStageIn .34s cubic-bezier(.22,1,.36,1);
}
.kmind-zen-guide-copy{
  display:flex;
  flex-direction:column;
  gap:18px;
  min-width:0;
  min-height:0;
  padding:22px 22px 22px 18px;
  border-left:1px solid var(--km-guide-border);
}
.kmind-zen-guide-copy__progress{display:flex;flex-wrap:wrap;gap:8px;}
.kmind-zen-guide-stepdot{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:30px;
  height:30px;
  padding:0 12px;
  border-radius:999px;
  font-size:12px;
  font-weight:600;
  transition:transform .18s ease,background-color .18s ease,border-color .18s ease;
  cursor:pointer;
}
.kmind-zen-guide-stepdot:hover{transform:translateY(-1px);}
.kmind-zen-guide-copy__meta{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.kmind-zen-guide-copy__eyebrow,
.kmind-zen-guide-copy__counter,
.kmind-zen-guide-copy__desc,
.kmind-zen-guide-callout__desc,
.kmind-zen-guide-footer__hint,
.kmind-zen-guide-linkcard__desc,
.kmind-zen-guide-demoPreview__caption,
.kmind-zen-guide-liveDemo__statusMeta,
.kmind-zen-guide-liveDemo__hint,
.kmind-zen-guide-liveDemo__loadingText{
  color:var(--km-guide-muted);
}
.kmind-zen-guide-copy__eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;}
.kmind-zen-guide-copy__counter{font-size:12px;line-height:1.5;}
.kmind-zen-guide-copy__title{margin:0;font-size:30px;line-height:1.08;letter-spacing:-.03em;}
.kmind-zen-guide-copy__desc{margin:10px 0 0;font-size:14px;line-height:1.72;}
.kmind-zen-guide-copy__stack{display:grid;gap:12px;}
.kmind-zen-guide-callout{border-radius:20px;padding:16px 18px;}
.kmind-zen-guide-callout__title{margin:0 0 6px;font-size:14px;font-weight:700;line-height:1.4;}
.kmind-zen-guide-callout__desc{margin:0;font-size:13px;line-height:1.68;}
.kmind-zen-guide-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.kmind-zen-guide-btn{
  appearance:none;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:112px;
  height:42px;
  padding:0 16px;
  border-radius:14px;
  font-size:14px;
  font-weight:600;
  cursor:pointer;
  transition:transform .18s ease,background-color .18s ease,border-color .18s ease;
}
.kmind-zen-guide-btn:hover{transform:translateY(-1px);background:var(--km-guide-fill-strong);}
.kmind-zen-guide-btn:active{transform:translateY(0);}
.kmind-zen-guide-btn:disabled{opacity:.42;cursor:not-allowed;transform:none;}
.kmind-zen-guide-btn--ghost{background:transparent;box-shadow:none;}
.kmind-zen-guide-btn--primary,
.kmind-zen-guide-liveDemo__controlBtn--primary{
  background:var(--km-guide-primary);
  color:var(--km-guide-on-primary);
  border-color:transparent;
  box-shadow:var(--km-guide-shadow-accent);
}
.kmind-zen-guide-btn--primary:hover,
.kmind-zen-guide-liveDemo__controlBtn--primary:hover{
  background:color-mix(in srgb, var(--km-guide-primary) 88%, black 12%);
}
.kmind-zen-guide-media,
.kmind-zen-guide-demoPreview__frame,
.kmind-zen-guide-liveDemo{
  border:1px solid var(--km-guide-border);
  background:
    linear-gradient(160deg, color-mix(in srgb, var(--km-guide-bg) 84%, transparent), color-mix(in srgb, var(--km-guide-bg) 62%, var(--km-guide-surface-light))),
    radial-gradient(circle at 18% 18%, var(--km-guide-cool-glow), transparent 28%),
    radial-gradient(circle at 84% 16%, var(--km-guide-warm-glow), transparent 24%);
  box-shadow:inset 0 1px 0 color-mix(in srgb, var(--km-guide-bg) 34%, transparent);
}
.kmind-zen-guide-media{
  position:relative;
  display:flex;
  flex:1 1 auto;
  min-height:0;
  overflow:hidden;
  border-radius:28px;
}
.kmind-zen-guide-media img{
  display:block;
  width:100%;
  height:100%;
  object-fit:contain;
}
.kmind-zen-guide-media__overlay{
  position:absolute;
  top:16px;
  left:16px;
  right:16px;
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  transition:opacity .28s ease,transform .28s ease;
}
.kmind-zen-guide-media__caption{
  position:absolute;
  left:16px;
  right:16px;
  bottom:16px;
  padding:12px 14px;
  border-radius:18px;
  background:var(--km-guide-glass-strong);
  font-size:13px;
  line-height:1.65;
  transition:opacity .28s ease,transform .28s ease;
}
@media (any-hover: hover), (hover: hover){
  .kmind-zen-guide-media--interactive .kmind-zen-guide-media__overlay,
  .kmind-zen-guide-media--interactive .kmind-zen-guide-media__caption{
    opacity:0;
    pointer-events:none;
  }
  .kmind-zen-guide-media--interactive .kmind-zen-guide-media__overlay{transform:translateY(-8px);}
  .kmind-zen-guide-media--interactive .kmind-zen-guide-media__caption{transform:translateY(10px);}
  .kmind-zen-guide-media--interactive:hover .kmind-zen-guide-media__overlay,
  .kmind-zen-guide-media--interactive:hover .kmind-zen-guide-media__caption,
  .kmind-zen-guide-media--interactive:focus-within .kmind-zen-guide-media__overlay,
  .kmind-zen-guide-media--interactive:focus-within .kmind-zen-guide-media__caption{
    opacity:1;
    transform:translateY(0);
  }
}
.kmind-zen-guide-links{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:14px;
  width:100%;
}
.kmind-zen-guide-linkcard{display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:22px;}
.kmind-zen-guide-linkcard__title{margin:0;font-size:16px;font-weight:700;line-height:1.35;}
.kmind-zen-guide-linkcard__desc{margin:0;font-size:13px;line-height:1.68;}
.kmind-zen-guide-footer{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  padding:16px 22px 22px;
  border-top:1px solid var(--km-guide-border);
}
.kmind-zen-guide-footer__hint{font-size:12px;line-height:1.6;}
.kmind-zen-guide-footer__nav{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.kmind-zen-guide-demoPreview{
  display:flex;
  flex:1 1 auto;
  flex-direction:column;
  gap:10px;
  min-height:0;
}
.kmind-zen-guide-demoPreview__frame{
  position:relative;
  display:flex;
  flex:1 1 auto;
  min-height:0;
  padding:14px;
  border-radius:30px;
}
.kmind-zen-guide-demoPreview__caption{margin:0;text-align:center;font-size:12px;line-height:1.5;}
.kmind-zen-guide-liveDemo{
  position:relative;
  display:flex;
  flex:1 1 auto;
  min-height:0;
  overflow:hidden;
  border-radius:24px;
}
.kmind-zen-guide-liveDemo--transitioning{filter:saturate(.96);}
.kmind-zen-guide-liveDemo__canvas{height:100%;width:100%;transition:opacity .28s ease,filter .26s ease,transform .26s ease;}
.kmind-zen-guide-liveDemo__canvas--hidden{opacity:0;pointer-events:none;}
.kmind-zen-guide-liveDemo__canvas--revealed{opacity:1;}
.kmind-zen-guide-liveDemo__canvas--transitioning{pointer-events:none;filter:blur(14px) saturate(.92);transform:scale(1.018);}
.kmind-zen-guide-liveDemo__cover{
  position:absolute;
  inset:0;
  opacity:0;
  background:color-mix(in srgb, var(--km-guide-bg) 70%, transparent);
  backdrop-filter:blur(24px);
  pointer-events:none;
  transition:opacity .22s ease;
}
.kmind-zen-guide-liveDemo__cover--visible{opacity:1;}
.kmind-zen-guide-liveDemo__top{position:absolute;left:16px;right:16px;top:16px;pointer-events:none;opacity:1;transition:opacity .28s ease;}
.kmind-zen-guide-liveDemo__top--hidden{opacity:0;}
.kmind-zen-guide-liveDemo__status{
  box-sizing:border-box;
  margin:0 auto;
  width:min(100%,720px);
  max-width:calc(100% - 2px);
  padding:14px 16px;
  border-radius:18px;
  background:var(--km-guide-glass-strong);
  backdrop-filter:blur(16px);
}
.kmind-zen-guide-liveDemo__status--inactive{pointer-events:none;}
.kmind-zen-guide-liveDemo__statusTitle{font-size:14px;font-weight:720;line-height:1.3;color:inherit;}
.kmind-zen-guide-liveDemo__statusMeta{margin-top:4px;font-size:12px;line-height:1.55;}
.kmind-zen-guide-liveDemo__progress{display:flex;align-items:center;gap:6px;width:100%;min-width:0;overflow:hidden;margin-top:12px;pointer-events:auto;}
.kmind-zen-guide-liveDemo__progress--inactive{pointer-events:none;}
.kmind-zen-guide-liveDemo__progressBtn{
  appearance:none;
  border:none;
  flex:1 1 0;
  min-width:0;
  height:4px;
  border-radius:999px;
  background:color-mix(in srgb, var(--km-guide-muted) 28%, transparent);
  cursor:pointer;
  transition:background-color .18s ease,transform .18s ease;
}
.kmind-zen-guide-liveDemo__progressBtn:hover{transform:scaleY(1.15);}
.kmind-zen-guide-liveDemo__progressBtn--complete{background:color-mix(in srgb, var(--km-guide-primary) 52%, transparent);}
.kmind-zen-guide-liveDemo__progressBtn--active{background:var(--km-guide-primary);}
.kmind-zen-guide-liveDemo__bottom{
  position:absolute;
  left:16px;
  right:16px;
  bottom:16px;
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:12px;
  flex-wrap:wrap;
  pointer-events:none;
  opacity:1;
  transition:opacity .28s ease;
}
.kmind-zen-guide-liveDemo__bottom--hidden{opacity:0;}
.kmind-zen-guide-liveDemo__controls{
  display:flex;
  align-items:center;
  gap:8px;
  max-width:100%;
  padding:10px;
  border-radius:18px;
  background:var(--km-guide-glass-strong);
  backdrop-filter:blur(14px);
  pointer-events:auto;
}
.kmind-zen-guide-liveDemo__controls--inactive{pointer-events:none;}
.kmind-zen-guide-liveDemo__controlBtn{
  appearance:none;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:38px;
  height:38px;
  border-radius:12px;
  cursor:pointer;
  transition:transform .18s ease,background-color .18s ease,opacity .18s ease;
}
.kmind-zen-guide-liveDemo__controlBtn:hover{transform:translateY(-1px);}
.kmind-zen-guide-liveDemo__controlBtn:active{transform:translateY(0);}
.kmind-zen-guide-liveDemo__controlBtn:disabled{opacity:.38;cursor:not-allowed;transform:none;}
.kmind-zen-guide-liveDemo__controlBtn svg{width:17px;height:17px;display:block;}
.kmind-zen-guide-liveDemo__hint{
  display:inline-flex;
  align-items:center;
  max-width:min(100%,360px);
  padding:10px 14px;
  border-radius:16px;
  background:var(--km-guide-glass-strong);
  backdrop-filter:blur(14px);
  font-size:12px;
  line-height:1.55;
  pointer-events:auto;
}
.kmind-zen-guide-liveDemo__hint--inactive{pointer-events:none;}
.kmind-zen-guide-liveDemo__loading{
  position:absolute;
  inset:0;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:12px;
  background:color-mix(in srgb, var(--km-guide-bg) 64%, transparent);
  backdrop-filter:blur(8px);
}
.kmind-zen-guide-liveDemo__spinner{
  width:40px;
  height:40px;
  border-radius:999px;
  border:3px solid color-mix(in srgb, var(--km-guide-muted) 24%, transparent);
  border-top-color:var(--km-guide-primary);
  animation:kmindGuideSpin .8s linear infinite;
}
.kmind-zen-guide-liveDemo__loadingText{font-size:12px;line-height:1.5;}
.kmind-zen-guide-liveDemo--transitioning .kmind-zen-guide-liveDemo__canvas{
  filter:blur(18px) saturate(.88) brightness(.96) !important;
  transform:scale(1.02) !important;
}
.kmind-zen-guide-liveDemo--transitioning .kmind-zen-guide-liveDemo__cover{opacity:1 !important;}
@keyframes kmindGuideSpin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
@keyframes kmindGuideStageIn{from{opacity:0;transform:translateY(10px) scale(.985);}to{opacity:1;transform:translateY(0) scale(1);}}
@media (max-width: 920px){
  .kmind-zen-guide-host,
  .kmind-zen-guide-root{min-height:auto;}
  .kmind-zen-guide-body{grid-template-columns:1fr;}
  .kmind-zen-guide-copy{border-left:none;border-top:1px solid var(--km-guide-border);}
  .kmind-zen-guide-stage{padding:18px 18px 0;}
  .kmind-zen-guide-copy{padding:18px;}
}
@media (max-width: 640px){
  .kmind-zen-guide-panel{border-radius:22px;}
  .kmind-zen-guide-header{padding:18px 18px 14px;}
  .kmind-zen-guide-footer{padding:14px 18px 18px;flex-direction:column;align-items:stretch;}
  .kmind-zen-guide-footer__nav{justify-content:stretch;}
  .kmind-zen-guide-footer__nav .kmind-zen-guide-btn{flex:1 1 0;}
  .kmind-zen-guide-copy__title{font-size:26px;}
  .kmind-zen-guide-links{grid-template-columns:1fr;}
  .kmind-zen-guide-demoPreview__frame{padding:10px;}
  .kmind-zen-guide-liveDemo__top{left:10px;right:10px;top:10px;}
  .kmind-zen-guide-liveDemo__bottom{left:10px;right:10px;bottom:10px;justify-content:flex-start;}
  .kmind-zen-guide-liveDemo__status{padding:12px 14px;}
  .kmind-zen-guide-liveDemo__controls{padding:8px;}
  .kmind-zen-guide-liveDemo__progress{gap:4px;}
  .kmind-zen-guide-liveDemo__hint{max-width:100%;}
}
@media (prefers-reduced-motion: reduce){
  .kmind-zen-guide-stepdot,
  .kmind-zen-guide-btn,
  .kmind-zen-guide-icon-btn,
  .kmind-zen-guide-liveDemo__canvas,
  .kmind-zen-guide-liveDemo__cover,
  .kmind-zen-guide-liveDemo__progressBtn,
  .kmind-zen-guide-liveDemo__controlBtn{transition:none !important;}
  .kmind-zen-guide-stage{animation:none !important;}
  .kmind-zen-guide-liveDemo__spinner{animation:none !important;}
}
  `.trim();
  if (!existing) document.head.appendChild(style);
}

function normalizeSvgIcon(svg: string | undefined): string | null {
  if (!svg) return null;
  const trimmed = String(svg).trim();
  return trimmed.startsWith("<svg") ? trimmed : null;
}

function openExternal(url: string): void {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function clampStepIndex(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(total - 1, value));
}

function createGuideSteps(media: GuideMediaMap): GuideStep[] {
  return [
    {
      id: "welcome",
      kind: "welcome",
      eyebrowKey: "obsidian.guide.step.welcome.eyebrow",
      titleKey: "obsidian.guide.step.welcome.title",
      descKey: "obsidian.guide.step.welcome.desc",
      callouts: [
        {
          titleKey: "obsidian.guide.step.welcome.callout.primary.title",
          descKey: "obsidian.guide.step.welcome.callout.primary.desc",
        },
        {
          titleKey: "obsidian.guide.step.welcome.callout.secondary.title",
          descKey: "obsidian.guide.step.welcome.callout.secondary.desc",
        },
      ],
    },
    {
      id: "command",
      kind: "media",
      eyebrowKey: "obsidian.guide.step.command.eyebrow",
      titleKey: "obsidian.guide.step.command.title",
      descKey: "obsidian.guide.step.command.desc",
      mediaSrc: media.commandPalette,
      mediaAltKey: "obsidian.guide.step.command.alt",
      callouts: [],
    },
    {
      id: "menu",
      kind: "media",
      eyebrowKey: "obsidian.guide.step.menu.eyebrow",
      titleKey: "obsidian.guide.step.menu.title",
      descKey: "obsidian.guide.step.menu.desc",
      mediaSrc: media.folderMenu,
      mediaAltKey: "obsidian.guide.step.menu.alt",
      callouts: [],
    },
    {
      id: "file",
      kind: "media",
      eyebrowKey: "obsidian.guide.step.file.eyebrow",
      titleKey: "obsidian.guide.step.file.title",
      descKey: "obsidian.guide.step.file.desc",
      mediaSrc: media.openFile,
      mediaAltKey: "obsidian.guide.step.file.alt",
      callouts: [],
    },
    {
      id: "zen",
      kind: "media",
      eyebrowKey: "obsidian.guide.step.zen.eyebrow",
      titleKey: "obsidian.guide.step.zen.title",
      descKey: "obsidian.guide.step.zen.desc",
      mediaSrc: media.zen,
      mediaAltKey: "obsidian.guide.step.zen.alt",
      callouts: [
        {
          titleKey: "obsidian.guide.step.zen.callout.primary.title",
          descKey: "obsidian.guide.step.zen.callout.primary.desc",
        },
        {
          titleKey: "obsidian.guide.step.zen.callout.secondary.title",
          descKey: "obsidian.guide.step.zen.callout.secondary.desc",
        },
      ],
    },
    {
      id: "follow",
      kind: "follow",
      eyebrowKey: "obsidian.guide.step.follow.eyebrow",
      titleKey: "obsidian.guide.step.follow.title",
      descKey: "obsidian.guide.step.follow.desc",
      callouts: [
        {
          titleKey: "obsidian.guide.step.follow.callout.primary.title",
          descKey: "obsidian.guide.step.follow.callout.primary.desc",
        },
      ],
    },
  ];
}

function GuideMediaPanel(props: { t: TFn; step: GuideStep }) {
  return (
    <div className="kmind-zen-guide-media kmind-zen-guide-media--interactive">
      {props.step.mediaSrc ? <img src={props.step.mediaSrc} alt={props.t(props.step.mediaAltKey ?? props.step.titleKey)} /> : null}
      <div className="kmind-zen-guide-media__overlay">
        <span className="kmind-zen-guide-chip kmind-zen-guide-chip--accent">{props.t(props.step.eyebrowKey)}</span>
        <span className="kmind-zen-guide-chip">{props.t("obsidian.guide.badge.placeholder")}</span>
      </div>
      <div className="kmind-zen-guide-media__caption">{props.t(props.step.descKey)}</div>
    </div>
  );
}

function GuideFollowPanel(props: { t: TFn }) {
  return (
    <div className="kmind-zen-guide-media">
      <div className="kmind-zen-guide-media__overlay">
        <span className="kmind-zen-guide-chip kmind-zen-guide-chip--accent">{props.t("obsidian.guide.step.follow.eyebrow")}</span>
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "flex-end", padding: 22 }}>
        <div className="kmind-zen-guide-links">
          <div className="kmind-zen-guide-linkcard">
            <p className="kmind-zen-guide-linkcard__title">{props.t("obsidian.guide.follow.website.title")}</p>
            <p className="kmind-zen-guide-linkcard__desc">{props.t("obsidian.guide.follow.website.desc")}</p>
            <button type="button" className="kmind-zen-guide-btn kmind-zen-guide-btn--primary" onClick={() => openExternal(GUIDE_SITE_URL)}>
              {props.t("obsidian.guide.action.website")}
            </button>
          </div>
          <div className="kmind-zen-guide-linkcard">
            <p className="kmind-zen-guide-linkcard__title">{props.t("obsidian.guide.follow.siyuan.title")}</p>
            <p className="kmind-zen-guide-linkcard__desc">{props.t("obsidian.guide.follow.siyuan.desc")}</p>
            <button type="button" className="kmind-zen-guide-btn" onClick={() => openExternal(GUIDE_SIYUAN_URL)}>
              {props.t("obsidian.guide.action.siyuan")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GuideDialogApp(props: { t: TFn; iconSvg: string; media: GuideMediaMap; onRequestClose: () => void }) {
  const steps = useMemo(() => createGuideSteps(props.media), [props.media]);
  const iconSvg = useMemo(() => normalizeSvgIcon(props.iconSvg), [props.iconSvg]);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setStepIndex((prev) => clampStepIndex(prev + 1, steps.length));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setStepIndex((prev) => clampStepIndex(prev - 1, steps.length));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [steps.length]);

  const step = steps[stepIndex] ?? steps[0];
  const total = steps.length;

  return (
    <div className="kmind-zen-guide-root">
      <div className="kmind-zen-guide-panel" role="dialog" aria-modal="true">
        <div className="kmind-zen-guide-panel__grain" />

        <div className="kmind-zen-guide-header">
          <div className="kmind-zen-guide-brand">
            <div className="kmind-zen-guide-brand__icon" aria-hidden="true" dangerouslySetInnerHTML={iconSvg ? { __html: iconSvg } : undefined} />
            <div className="kmind-zen-guide-brand__copy">
              <div className="kmind-zen-guide-brand__eyebrow">
                <span className="kmind-zen-guide-chip kmind-zen-guide-chip--accent">{props.t("obsidian.guide.title")}</span>
                <span className="kmind-zen-guide-chip">{props.t("obsidian.guide.badge.firstRun")}</span>
              </div>
              <h2 className="kmind-zen-guide-title">{props.t("obsidian.guide.title")}</h2>
              <p className="kmind-zen-guide-subtitle">{props.t("obsidian.guide.subtitle")}</p>
            </div>
          </div>

          <div className="kmind-zen-guide-header__actions">
            <button type="button" className="kmind-zen-guide-icon-btn" title={props.t("obsidian.guide.action.close")} onClick={props.onRequestClose}>
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="kmind-zen-guide-body">
          <div className="kmind-zen-guide-stage" key={step.id}>
            {step.kind === "welcome" ? (
              <ObsidianGuideDemoPreview t={props.t} />
            ) : step.kind === "follow" ? (
              <GuideFollowPanel t={props.t} />
            ) : (
              <GuideMediaPanel t={props.t} step={step} />
            )}
          </div>

          <div className="kmind-zen-guide-copy">
            <div className="kmind-zen-guide-copy__progress">
              {steps.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={index === stepIndex ? "kmind-zen-guide-stepdot kmind-zen-guide-stepdot--active" : "kmind-zen-guide-stepdot"}
                  onClick={() => setStepIndex(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>

            <div className="kmind-zen-guide-copy__meta">
              <div className="kmind-zen-guide-copy__eyebrow">{props.t(step.eyebrowKey)}</div>
              <div className="kmind-zen-guide-copy__counter">{props.t("obsidian.guide.stepCounter", { current: stepIndex + 1, total })}</div>
            </div>

            <div>
              <h3 className="kmind-zen-guide-copy__title">{props.t(step.titleKey)}</h3>
              <p className="kmind-zen-guide-copy__desc">{props.t(step.descKey)}</p>
            </div>

            <div className="kmind-zen-guide-copy__stack">
              {(step.callouts ?? []).map((callout) => (
                <div key={callout.titleKey} className="kmind-zen-guide-callout">
                  <p className="kmind-zen-guide-callout__title">{props.t(callout.titleKey)}</p>
                  <p className="kmind-zen-guide-callout__desc">{props.t(callout.descKey)}</p>
                </div>
              ))}
            </div>

            {step.id === "follow" ? (
              <div className="kmind-zen-guide-actions">
                <button type="button" className="kmind-zen-guide-btn kmind-zen-guide-btn--primary" onClick={() => openExternal(GUIDE_SITE_URL)}>
                  {props.t("obsidian.guide.action.website")}
                </button>
                <button type="button" className="kmind-zen-guide-btn" onClick={() => openExternal(GUIDE_SIYUAN_URL)}>
                  {props.t("obsidian.guide.action.siyuan")}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="kmind-zen-guide-footer">
          <div className="kmind-zen-guide-footer__hint">{props.t("obsidian.guide.footer.hint")}</div>
          <div className="kmind-zen-guide-footer__nav">
            <button
              type="button"
              className="kmind-zen-guide-btn kmind-zen-guide-btn--ghost"
              onClick={() => setStepIndex((prev) => clampStepIndex(prev - 1, total))}
              disabled={stepIndex <= 0}
            >
              {props.t("obsidian.guide.action.prev")}
            </button>
            <button
              type="button"
              className="kmind-zen-guide-btn kmind-zen-guide-btn--primary"
              onClick={() => {
                if (stepIndex >= total - 1) {
                  props.onRequestClose();
                  return;
                }
                setStepIndex((prev) => clampStepIndex(prev + 1, total));
              }}
            >
              {stepIndex >= total - 1 ? props.t("obsidian.guide.action.done") : props.t("obsidian.guide.action.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

class KmindZenObsidianOnboardingModal extends Modal {
  private reactRoot: Root | null = null;
  private readonly t: TFn;
  private readonly iconSvg: string;
  private readonly media: GuideMediaMap;
  private readonly onClosed?: (() => void) | undefined;

  constructor(args: OpenOnboardingArgs) {
    super(args.app);
    this.t = args.t;
    this.iconSvg = args.iconSvg;
    this.media = args.media;
    this.onClosed = args.onClose;
  }

  override onOpen(): void {
    ensureGuideStyles();
    this.modalEl.addClass("kmind-zen-guide-modal-shell");
    this.modalEl.style.width = "min(1080px, calc(100vw - 32px))";
    this.modalEl.style.maxWidth = "1080px";
    this.titleEl.style.display = "none";
    this.contentEl.empty();
    this.contentEl.style.padding = "0";
    this.contentEl.style.overflow = "hidden";
    const closeBtn = this.modalEl.querySelector(".modal-close-button");
    if (closeBtn instanceof HTMLElement) closeBtn.style.display = "none";

    const container = this.contentEl.createDiv({ cls: "kmind-zen-guide-host" });
    this.reactRoot = createRoot(container);
    this.reactRoot.render(
      <GuideDialogApp
        t={this.t}
        iconSvg={this.iconSvg}
        media={this.media}
        onRequestClose={() => this.close()}
      />,
    );
  }

  override onClose(): void {
    try {
      this.reactRoot?.unmount();
    } finally {
      this.reactRoot = null;
      this.contentEl.empty();
      this.onClosed?.();
    }
  }
}

export function openKmindZenObsidianOnboardingModal(args: OpenOnboardingArgs): KmindZenObsidianOnboardingModal {
  const modal = new KmindZenObsidianOnboardingModal(args);
  modal.open();
  return modal;
}
