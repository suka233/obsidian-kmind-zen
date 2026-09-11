import { Modal, type App } from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@kmind/editor-react";

import { createObsidianUiI18n } from "../i18n/ui-i18n";
import { ObsidianLicensePaywall } from "./obsidian-license-paywall";

class ObsidianLicensePaywallModal extends Modal {
  private reactRoot: Root | null = null;
  private reactContainerEl: HTMLDivElement | null = null;
  private readonly initialPurchaseOpen: boolean;

  constructor(app: App, options?: { initialPurchaseOpen?: boolean | undefined }) {
    super(app);
    this.initialPurchaseOpen = Boolean(options?.initialPurchaseOpen);
  }

  override onOpen(): void {
    const uiI18n = createObsidianUiI18n();
    this.titleEl.setText(uiI18n.t("obsidian.paywall.title"));
    this.modalEl.style.width = "min(860px, calc(100vw - 32px))";
    this.contentEl.empty();
    const container = this.contentEl.createEl("div");
    container.style.minHeight = "560px";
    this.reactContainerEl = container;
    this.reactRoot = createRoot(container);
    this.reactRoot.render(
      <I18nProvider i18n={uiI18n}>
        <ObsidianLicensePaywall
          initialPurchaseOpen={this.initialPurchaseOpen}
          onPurchaseSuccess={() => {
            this.close();
          }}
        />
      </I18nProvider>,
    );
  }

  override onClose(): void {
    try {
      this.reactRoot?.unmount();
    } finally {
      this.reactRoot = null;
      this.reactContainerEl = null;
      this.contentEl.empty();
    }
  }
}

export function openObsidianLicensePaywallModal(
  app: App,
  options?: { initialPurchaseOpen?: boolean | undefined },
): void {
  new ObsidianLicensePaywallModal(app, options).open();
}
