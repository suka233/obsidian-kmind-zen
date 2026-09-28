import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";

import { createKeymapSettingsSnapshot, type KmindAppSnapshot } from "@kmind/app";
import { ShortcutSettingsPopover } from "@kmind/app-react";
import { I18nProvider, useT } from "@kmind/editor-react";
import type { I18n } from "@kmind/i18n";
import { Notice, type App } from "obsidian";

import { kmindZenObsidianKeymapOverridesStore } from "../runtime/keymap-overrides-store";

function ObsidianShortcutSettingsSection(props: { app: App; i18n: I18n }) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<KmindAppSnapshot | null>(null);
  const overrides = useSyncExternalStore(
    kmindZenObsidianKeymapOverridesStore.subscribe,
    kmindZenObsidianKeymapOverridesStore.getState,
    kmindZenObsidianKeymapOverridesStore.getState,
  );

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | null = null;
    void createKeymapSettingsSnapshot({ i18n: props.i18n, hostId: "obsidian" }).then((result) => {
      if (!active) {
        result.dispose();
        return;
      }
      dispose = result.dispose;
      setSnapshot(result.snapshot);
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, [props.i18n]);

  if (!snapshot) return <div>{t("kmind.common.loading")}</div>;

  return (
    <ShortcutSettingsPopover
      onSave={async (next) => {
        await kmindZenObsidianKeymapOverridesStore.set(props.app, next);
        new Notice(t("obsidian.settings.shortcuts.saved"));
      }}
      overrides={overrides}
      hostId="obsidian"
      snapshot={snapshot}
    />
  );
}

export function mountObsidianShortcutSettingsSection(args: { container: HTMLElement; app: App; i18n: I18n }): () => void {
  const root: Root = createRoot(args.container);
  root.render(
    <I18nProvider i18n={args.i18n}>
      <ObsidianShortcutSettingsSection app={args.app} i18n={args.i18n} />
    </I18nProvider>,
  );
  return () => root.unmount();
}
