import { createRoot, type Root } from "react-dom/client";

import {
  KMIND_THEME_ONLINE_SHARING_ENABLED,
  loadLocalThemeLibraryIndex,
  markLocalThemePackageShared,
  type KmindThemePackageV1,
} from "@kmind/app";
import { ThemeDesigner } from "@kmind/app-react";
import { I18nProvider } from "@kmind/editor-react";
import type { I18n } from "@kmind/i18n";
import { Modal, Notice, type App } from "obsidian";

import {
  apiCreatePluginThemeShareSession,
  apiGetPluginThemeShareSessionStatus,
} from "../runtime/theme-share-api";
import { getObsidianThemeLibraryStoragePort } from "../runtime/theme-library-storage";
import { resolveObsidianLocale } from "../i18n/ui-i18n";

type TFn = (key: string, params?: Record<string, unknown> | undefined) => string;

export class KmindZenThemeDesignerModal extends Modal {
  private root: Root | null = null;
  private readonly sharePollTimers = new Set<number>();

  constructor(app: App, private readonly i18n: I18n, private readonly iconSvg: string) {
    super(app);
  }

  private t: TFn = (key, params) => this.i18n.t(key, params);

  override onOpen(): void {
    this.titleEl.setText(this.t("obsidian.themeDesigner.modal.title"));
    this.contentEl.empty();
    this.contentEl.style.height = "min(78vh, 760px)";
    this.contentEl.style.minHeight = "620px";
    this.contentEl.style.overflow = "hidden";
    this.modalEl.style.width = "min(1180px, 96vw)";

    const storage = getObsidianThemeLibraryStoragePort(this.app);
    this.root = createRoot(this.contentEl);
    this.contentEl.setText(this.t("kmind.common.loading"));
    void storage
      .hydrate()
      .then(() => {
        this.root?.render(
          <I18nProvider i18n={this.i18n}>
            <ThemeDesigner
              locale={resolveObsidianLocale()}
              mode="obsidian"
              brandIconSvg={this.iconSvg}
              themeLibraryStorage={storage}
              canShare={KMIND_THEME_ONLINE_SHARING_ENABLED}
              shareButtonLabel={this.t("obsidian.themeDesigner.action.share")}
              shareSuccessMessage={this.t("obsidian.themeDesigner.notice.shareOpened")}
              onSaveTheme={() => {
                new Notice(this.t("obsidian.themeDesigner.notice.saved"), 2200);
              }}
              onShareTheme={(themePackage) => this.shareTheme(themePackage)}
              style={{ height: "100%", minHeight: "100%" }}
            />
          </I18nProvider>,
        );
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`${this.t("obsidian.themeDesigner.notice.loadFailed")}: ${message}`, 3000);
      });
  }

  override onClose(): void {
    for (const timer of this.sharePollTimers) window.clearTimeout(timer);
    this.sharePollTimers.clear();
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }

  private scheduleShareStatusPoll(statusUrl: string, themePackageId: string): void {
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      const response = await apiGetPluginThemeShareSessionStatus(statusUrl);
      if (!response.ok) {
        if (attempts >= 3) {
          new Notice(`${this.t("obsidian.themeDesigner.notice.shareFailed")}: ${response.error}`, 3600);
          return;
        }
      } else if (response.status === "submitted") {
        if (response.sharedContentId) {
          const storage = getObsidianThemeLibraryStoragePort(this.app);
          markLocalThemePackageShared(storage, themePackageId, {
            sharedContentId: response.sharedContentId,
            ...(response.slug ? { slug: response.slug } : {}),
            ...(response.sharedContentVersionId ? { sharedContentVersionId: response.sharedContentVersionId } : {}),
            ...(response.sharedContentStatus ? { lastStatus: response.sharedContentStatus } : {}),
            lastSubmittedAt: Date.now(),
          });
          await storage.flush();
        }
        new Notice(this.t("obsidian.themeDesigner.notice.shareSubmitted"), 3200);
        return;
      } else if (response.status === "expired") {
        new Notice(this.t("obsidian.themeDesigner.notice.shareExpired"), 3600);
        return;
      } else if (response.status === "failed") {
        new Notice(`${this.t("obsidian.themeDesigner.notice.shareFailed")}: ${response.errorMessage ?? response.errorCode ?? ""}`, 3600);
        return;
      }
      if (attempts >= 180) return;
      const timer = window.setTimeout(poll, 3000);
      this.sharePollTimers.add(timer);
    };
    const timer = window.setTimeout(poll, 3000);
    this.sharePollTimers.add(timer);
  }

  private async shareTheme(themePackage: KmindThemePackageV1): Promise<void> {
    const storage = getObsidianThemeLibraryStoragePort(this.app);
    const existing = loadLocalThemeLibraryIndex(storage).items.find((item) => item.id === themePackage.id)?.share;
    const response = await apiCreatePluginThemeShareSession({
      themePackage,
      language: resolveObsidianLocale(),
      sharedContentId: existing?.sharedContentId,
    });
    if (!response.ok) {
      throw new Error(response.error);
    }
    window.open(response.confirmUrl, "_blank", "noopener,noreferrer");
    new Notice(this.t("obsidian.themeDesigner.notice.shareOpened"), 3600);
    this.scheduleShareStatusPoll(response.statusUrl, themePackage.id);
  }
}

export function openKmindZenObsidianThemeDesignerModal(app: App, i18n: I18n, iconSvg: string): KmindZenThemeDesignerModal {
  const modal = new KmindZenThemeDesignerModal(app, i18n, iconSvg);
  modal.open();
  return modal;
}
