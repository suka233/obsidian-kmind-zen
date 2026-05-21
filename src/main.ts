import { Menu, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, type TAbstractFile } from "obsidian";

import onboardingCommandImage from "../public/onboarding/obsidian-command.webp?inline";
import onboardingFolderMenuImage from "../public/onboarding/obsidian-folder-menu.webp?inline";
import onboardingOpenFileImage from "../public/onboarding/obsidian-open-file.webp?inline";
import onboardingZenImage from "../public/onboarding/obsidian-zen.webp?inline";
import rawIconSvg from "./assets/kmind-adjusted.svg?raw";
import { createEmptyKmindzText } from "./storage/kmindz-svg";
import { devReloadPluginNow, maybeReopenAfterDevReload, setupDevAutoReload } from "./runtime/dev-hot-reload";
import { ensureKmindZenViewModesDefaultsLoaded, kmindZenViewModesDefaultsStore } from "./runtime/view-modes-defaults-store";
import { ensureKmindZenObsidianKeymapOverridesLoaded, kmindZenObsidianKeymapOverridesStore } from "./runtime/keymap-overrides-store";
import { VIEW_TYPE_KMIND, KmindFileView } from "./views/kmind-file-view";
import { createObsidianDialogPort } from "./host/obsidian/obsidian-dialog";
import { bootstrapKmindZenObsidianLicense } from "./runtime/license/license-bootstrap";
import { kmindZenObsidianLicenseStore } from "./runtime/license/license-store";
import { apiActivateLicense, apiClaimTrial } from "./runtime/license/remote-license-api";
import { createObsidianUiI18n } from "./i18n/ui-i18n";
import { openKmindZenObsidianOnboardingModal } from "./ui/obsidian-onboarding-modal";
import { openObsidianLicensePaywallModal } from "./ui/obsidian-license-paywall-modal";
import { mountObsidianShortcutSettingsSection } from "./ui/obsidian-shortcut-settings-section";
import { openKmindZenObsidianThemeDesignerModal } from "./ui/obsidian-theme-designer-modal";

const DEFAULT_MAP_DIR = "KMind";
const ONBOARDING_SEEN_VERSION = 1;

type KmindZenPluginData = {
  onboarding?: {
    obsidianGuideSeenVersion?: number | undefined;
  } | undefined;
};

class KmindZenSettingsTab extends PluginSettingTab {
  constructor(
    app: PluginSettingTab["app"],
    plugin: PluginSettingTab["plugin"],
    private readonly i18n: ReturnType<typeof createObsidianUiI18n>,
    private readonly t: (key: string, params?: Record<string, unknown> | undefined) => string,
    private readonly openGuide: () => void,
    private readonly openThemeDesigner: () => void,
  ) {
    super(app, plugin);
  }

  private unmountShortcutSettings: (() => void) | null = null;

  override display(): void {
    const t = this.t;
    const { containerEl } = this;
    this.unmountShortcutSettings?.();
    this.unmountShortcutSettings = null;
    containerEl.empty();
    containerEl.createEl("h2", { text: t("obsidian.settings.title") });

    const state = kmindZenViewModesDefaultsStore.getState();

    containerEl.createEl("h3", { text: t("obsidian.settings.section.guide") });
    new Setting(containerEl)
      .setName(t("obsidian.settings.section.guide"))
      .setDesc(t("obsidian.settings.guide.desc"))
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.settings.guide.button.open"));
        btn.setCta();
        btn.onClick(() => {
          this.openGuide();
        });
      });

    containerEl.createEl("h3", { text: t("obsidian.settings.section.themeDesigner") });
    new Setting(containerEl)
      .setName(t("obsidian.settings.themeDesigner.label"))
      .setDesc(t("obsidian.settings.themeDesigner.desc"))
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.settings.themeDesigner.button.open"));
        btn.onClick(() => {
          this.openThemeDesigner();
        });
      });

    new Setting(containerEl)
      .setName(t("obsidian.settings.viewModes.zen.label"))
      .setDesc(t("obsidian.settings.viewModes.zen.desc"))
      .addToggle((toggle) => {
        toggle.setValue(state.zenMode);
        toggle.onChange((value) => {
          void kmindZenViewModesDefaultsStore.set(this.app, { zenMode: value });
        });
      });

    new Setting(containerEl)
      .setName(t("obsidian.settings.viewModes.readOnly.label"))
      .setDesc(t("obsidian.settings.viewModes.readOnly.desc"))
      .addToggle((toggle) => {
        toggle.setValue(state.readOnly);
        toggle.onChange((value) => {
          void kmindZenViewModesDefaultsStore.set(this.app, { readOnly: value });
        });
      });

    containerEl.createEl("h3", { text: t("obsidian.settings.section.nodeEntryControls") });

    new Setting(containerEl)
      .setName(t("obsidian.settings.nodeEntryControls.addChild.label"))
      .setDesc(t("obsidian.settings.nodeEntryControls.addChild.desc"))
      .addToggle((toggle) => {
        toggle.setValue(state.showAddChildButton);
        toggle.onChange((value) => {
          void kmindZenViewModesDefaultsStore.set(this.app, { showAddChildButton: value });
        });
      });

    new Setting(containerEl)
      .setName(t("obsidian.settings.nodeEntryControls.nodeMenu.label"))
      .setDesc(t("obsidian.settings.nodeEntryControls.nodeMenu.desc"))
      .addToggle((toggle) => {
        toggle.setValue(state.showNodeMenuTrigger);
        toggle.onChange((value) => {
          void kmindZenViewModesDefaultsStore.set(this.app, { showNodeMenuTrigger: value });
        });
      });

    containerEl.createEl("h3", { text: t("obsidian.settings.section.shortcuts") });
    const shortcutEditor = containerEl.createDiv({ cls: "kmind-zen-obsidian-shortcut-settings" });
    shortcutEditor.style.maxHeight = "520px";
    shortcutEditor.style.overflow = "auto";
    shortcutEditor.style.border = "1px solid var(--background-modifier-border)";
    shortcutEditor.style.borderRadius = "8px";
    shortcutEditor.style.marginBottom = "12px";
    this.unmountShortcutSettings = mountObsidianShortcutSettingsSection({ container: shortcutEditor, app: this.app, i18n: this.i18n });
    new Setting(containerEl)
      .setName(t("obsidian.settings.shortcuts.global.label"))
      .setDesc(t("obsidian.settings.shortcuts.global.desc"))
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.settings.shortcuts.reset"));
        btn.onClick(() => {
          void kmindZenObsidianKeymapOverridesStore.reset(this.app).finally(() => this.display());
        });
      });

    containerEl.createEl("h3", { text: t("obsidian.settings.section.license") });

    const licenseSnapshot = kmindZenObsidianLicenseStore.getSnapshot();
    const plan = licenseSnapshot.payload?.plan ?? t("kmind.common.emptyDash");
    const expiresAtText = (() => {
      if (!licenseSnapshot.payload) return t("kmind.common.emptyDash");
      if (licenseSnapshot.payload.plan === "perpetual") return t("obsidian.settings.license.expires.never");
      if (!licenseSnapshot.payload.expiresAtMs) return t("kmind.common.emptyDash");
      try {
        return new Date(licenseSnapshot.payload.expiresAtMs).toLocaleString();
      } catch {
        return String(licenseSnapshot.payload.expiresAtMs);
      }
    })();
    const statusLabel =
      licenseSnapshot.status === "active"
        ? t("obsidian.license.status.active")
        : licenseSnapshot.status === "expired"
          ? t("obsidian.license.status.expired")
          : licenseSnapshot.status === "invalid"
            ? t("obsidian.license.status.invalid")
            : licenseSnapshot.status === "none"
              ? t("obsidian.license.status.none")
              : licenseSnapshot.status;
    const statusLine = t("obsidian.settings.license.statusLine", { status: statusLabel, plan, expires: expiresAtText });

    new Setting(containerEl)
      .setName(t("obsidian.settings.license.status.label"))
      .setDesc(statusLine)
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.settings.license.action.refresh"));
        btn.onClick(() => {
          void bootstrapKmindZenObsidianLicense().finally(() => this.display());
        });
      });

    const dialog = createObsidianDialogPort(this.app);
    const normalizeEmail = (value: string) => String(value ?? "").trim().replaceAll(/\s+/g, "").toLowerCase();
    const isValidEmail = (email: string) => email.length > 0 && email.length <= 254 && email.includes("@");
    const normalizeKey = (value: string) => String(value ?? "").trim().replaceAll(/\s+/g, "").toUpperCase();

    let busy = false;
    const run = (fn: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      void fn()
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`KMind Zen: ${message || t("obsidian.error.operationFailed")}`);
        })
        .finally(() => {
          busy = false;
          this.display();
        });
    };

    new Setting(containerEl)
      .setName(t("obsidian.settings.section.actions"))
      .setDesc(t("obsidian.settings.actions.desc"))
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.settings.actions.button.startTrial"));
        btn.setCta();
        btn.onClick(() => {
          run(async () => {
            const rawEmail = await dialog.prompt({ title: t("obsidian.settings.title"), message: t("obsidian.settings.prompt.emailForTrial") });
            if (rawEmail === null) return;
            const email = normalizeEmail(rawEmail);
            if (!isValidEmail(email)) throw new Error(t("obsidian.error.invalidEmail"));
            await kmindZenObsidianLicenseStore.ensureLoaded();
            const devicePubKeyB64 = kmindZenObsidianLicenseStore.getDevicePubKeyB64();
            if (!devicePubKeyB64) throw new Error(t("obsidian.error.deviceKeyMissing"));
            const res = await apiClaimTrial({ email, devicePubKeyB64 });
            if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
            await kmindZenObsidianLicenseStore.setSession(res.result);
            new Notice(t("obsidian.notice.trialActivated"));
          });
        });
      })
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.settings.actions.button.activate"));
        btn.setCta();
        btn.onClick(() => {
          run(async () => {
            const rawEmail = await dialog.prompt({ title: t("obsidian.settings.title"), message: t("obsidian.settings.prompt.emailForBind") });
            if (rawEmail === null) return;
            const email = normalizeEmail(rawEmail);
            if (!isValidEmail(email)) throw new Error(t("obsidian.error.invalidEmail"));

            const rawKey = await dialog.prompt({ title: t("obsidian.settings.title"), message: t("obsidian.settings.prompt.activationKey") });
            if (rawKey === null) return;
            const licenseKey = normalizeKey(rawKey);
            if (!licenseKey) throw new Error(t("obsidian.error.missingActivationKey"));

            await kmindZenObsidianLicenseStore.ensureLoaded();
            const devicePubKeyB64 = kmindZenObsidianLicenseStore.getDevicePubKeyB64();
            if (!devicePubKeyB64) throw new Error(t("obsidian.error.deviceKeyMissing"));

            const res = await apiActivateLicense({ licenseKey, email, devicePubKeyB64 });
            if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
            await kmindZenObsidianLicenseStore.setSession(res.result);
            new Notice(t("obsidian.notice.activated"));
          });
        });
      })
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.settings.actions.button.clearLocal"));
        btn.onClick(() => {
          run(async () => {
            const ok = await dialog.confirm(t("obsidian.settings.confirm.clearLocal"));
            if (!ok) return;
            await kmindZenObsidianLicenseStore.clearSession();
            new Notice(t("obsidian.notice.localCleared"));
          });
        });
      })
      .addButton((btn) => {
        btn.setButtonText(t("obsidian.settings.actions.button.buy"));
        btn.onClick(() => {
          openObsidianLicensePaywallModal(this.app, { initialPurchaseOpen: true });
        });
      });
  }

  override hide(): void {
    this.unmountShortcutSettings?.();
    this.unmountShortcutSettings = null;
    super.hide();
  }
}

function normalizeVaultPath(path: string): string {
  return String(path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function sanitizeFileName(name: string): string {
  const trimmed = String(name ?? "").trim() || "Untitled";
  return trimmed.replace(/[\\/]+/g, "_");
}

async function ensureFolder(plugin: Plugin, dir: string): Promise<void> {
  const { vault } = plugin.app;
  const normalized = normalizeVaultPath(dir).replace(/\/+$/g, "");
  if (!normalized) return;
  const existing = vault.getAbstractFileByPath(normalized);
  if (existing instanceof TFile) throw new Error(`Cannot create folder "${normalized}": a file exists at that path.`);
  if (existing) return;
  await vault.createFolder(normalized);
}

async function createUniqueFile(plugin: Plugin, dir: string, baseName: string, ext: string): Promise<string> {
  const { vault } = plugin.app;
  const normalizedDir = normalizeVaultPath(dir).replace(/\/+$/g, "");
  const safeBase = sanitizeFileName(baseName);
  const join = (name: string) => (normalizedDir ? `${normalizedDir}/${name}` : name);
  const withExt = (name: string) => join(`${name}.${ext}`);

  if (!vault.getAbstractFileByPath(withExt(safeBase))) return withExt(safeBase);
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${safeBase} (${i})`;
    if (!vault.getAbstractFileByPath(withExt(candidate))) return withExt(candidate);
  }
  return withExt(`${safeBase}-${Date.now()}`);
}

export default class KmindZenObsidianPlugin extends Plugin {
  private devHotReload: { dispose: () => void } | null = null;
  private uiI18n: ReturnType<typeof createObsidianUiI18n> | null = null;
  private pluginData: KmindZenPluginData = {};
  private onboardingModal: { close: () => void } | null = null;

  private async createNewMapAt(args: { dir: string; title?: string | undefined }): Promise<TFile> {
    await ensureFolder(this, args.dir);
    const fallbackTitle = this.uiI18n?.t("obsidian.map.untitled") ?? "Untitled";
    const title = String(args.title ?? "").trim() || fallbackTitle;
    const path = await createUniqueFile(this, args.dir, title, "kmindz");
    const text = await createEmptyKmindzText({ title });
    return this.app.vault.create(path, text);
  }

  private getT(): ((key: string, params?: Record<string, unknown> | undefined) => string) | null {
    if (!this.uiI18n) return null;
    return (key, params) => this.uiI18n!.t(key, params);
  }

  private isOnboardingSeen(): boolean {
    return (this.pluginData.onboarding?.obsidianGuideSeenVersion ?? 0) >= ONBOARDING_SEEN_VERSION;
  }

  private async markOnboardingSeen(): Promise<void> {
    if (this.isOnboardingSeen()) return;
    this.pluginData = {
      ...this.pluginData,
      onboarding: {
        ...(this.pluginData.onboarding ?? {}),
        obsidianGuideSeenVersion: ONBOARDING_SEEN_VERSION,
      },
    };
    await this.saveData(this.pluginData);
  }

  private openOnboardingGuide(): void {
    const t = this.getT();
    if (!t) return;
    this.onboardingModal?.close();
    this.onboardingModal = openKmindZenObsidianOnboardingModal({
      app: this.app,
      t,
      iconSvg: rawIconSvg,
      media: {
        commandPalette: onboardingCommandImage,
        folderMenu: onboardingFolderMenuImage,
        openFile: onboardingOpenFileImage,
        zen: onboardingZenImage,
      },
      onClose: () => {
        this.onboardingModal = null;
      },
    });
  }

  private openThemeDesigner(): void {
    if (!this.uiI18n) return;
    openKmindZenObsidianThemeDesignerModal(this.app, this.uiI18n, rawIconSvg);
  }

  private async maybeAutoOpenOnboardingGuide(): Promise<void> {
    if (this.isOnboardingSeen()) return;
    await this.markOnboardingSeen();
    this.openOnboardingGuide();
  }

  override async onload(): Promise<void> {
    this.pluginData = ((await this.loadData()) as KmindZenPluginData | null) ?? {};
    const uiI18n = createObsidianUiI18n();
    this.uiI18n = uiI18n;
    const t = (key: string, params?: Record<string, unknown> | undefined) => uiI18n.t(key, params);

    await ensureKmindZenViewModesDefaultsLoaded(this.app);
    await ensureKmindZenObsidianKeymapOverridesLoaded(this.app);

    void kmindZenObsidianLicenseStore.ensureLoaded().catch((error) => {
      console.warn("[kmind-zen] license ensureLoaded failed:", error);
    });
    void bootstrapKmindZenObsidianLicense();

    this.registerView(VIEW_TYPE_KMIND, (leaf) => new KmindFileView(leaf));
    this.registerExtensions(["kmindz"], VIEW_TYPE_KMIND);

    this.addSettingTab(new KmindZenSettingsTab(this.app, this, uiI18n, t, () => this.openOnboardingGuide(), () => this.openThemeDesigner()));

    this.addCommand({
      id: "kmind-new-map",
      name: t("obsidian.command.newMap"),
      callback: async () => {
        try {
          const file = await this.createNewMapAt({ dir: DEFAULT_MAP_DIR, title: t("obsidian.map.untitled") });
          await this.app.workspace.getLeaf(true).openFile(file);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(t("obsidian.error.createMapFailed", { message }));
        }
      },
    });

    this.addCommand({
      id: "kmind-reopen-active-file",
      name: t("obsidian.command.openActiveFile"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (file.extension !== "kmindz") return false;
        if (checking) return true;
        void this.app.workspace.getLeaf(true).openFile(file);
        return true;
      },
    });

    this.addCommand({
      id: "kmind-quick-start-guide",
      name: t("obsidian.command.quickStart"),
      callback: () => {
        this.openOnboardingGuide();
      },
    });

    this.addCommand({
      id: "kmind-open-theme-designer",
      name: t("obsidian.command.themeDesigner"),
      callback: () => {
        this.openThemeDesigner();
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        menu.addItem((item) => {
          item.setTitle(t("obsidian.menu.newMap"));
          item.onClick(() => {
            const dir = file instanceof TFolder ? file.path : file.parent?.path ?? "";
            void this.createNewMapAt({ dir, title: t("obsidian.map.untitled") })
              .then((created) => this.app.workspace.getLeaf(true).openFile(created))
              .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                new Notice(t("obsidian.error.createMapFailed", { message }));
              });
          });
        });
      }),
    );

    this.addCommand({
      id: "kmind-dev-reload-plugin",
      name: "KMind Dev: Reload plugin",
      callback: () => {
        void devReloadPluginNow(this);
      },
    });

    this.devHotReload = setupDevAutoReload(this);
    await maybeReopenAfterDevReload(this);
    this.app.workspace.onLayoutReady(() => {
      void this.maybeAutoOpenOnboardingGuide().catch((error) => {
        console.error("[kmind-zen] open onboarding guide failed:", error);
      });
    });
  }

  override onunload(): void {
    this.onboardingModal?.close();
    this.onboardingModal = null;
    this.devHotReload?.dispose();
    this.devHotReload = null;
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_KMIND);
  }
}
