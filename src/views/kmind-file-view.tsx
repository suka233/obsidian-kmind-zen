import { TextFileView } from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import { KmindObsidianViewApp } from "../ui/kmind-obsidian-view-app";

export const VIEW_TYPE_KMIND = "kmind-zen-view";

export class KmindFileView extends TextFileView {
  private raw = "";
  private reactRoot: Root | null = null;
  private reactContainerEl: HTMLDivElement | null = null;

  override getViewType(): string {
    return VIEW_TYPE_KMIND;
  }

  override getDisplayText(): string {
    return this.file?.basename ? `${this.file.basename}.kmindz` : "KMind";
  }

  override getViewData(): string {
    return this.raw;
  }

  override setViewData(data: string, clear: boolean): void {
    this.raw = data;
    this.renderReact();
  }

  override clear(): void {
    this.raw = "";
    this.renderReact();
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("kmind-zen");
    (this.contentEl as HTMLElement).style.padding = "0";
    (this.contentEl as HTMLElement).style.position = "relative";

    const container = this.contentEl.createEl("div", { cls: "kmind-zen-view" });
    container.style.position = "absolute";
    container.style.inset = "0";
    this.reactContainerEl = container;
    this.reactRoot = createRoot(container);
    this.renderReact();
  }

  override async onClose(): Promise<void> {
    try {
      this.reactRoot?.unmount();
    } finally {
      this.reactRoot = null;
      this.reactContainerEl = null;
    }
  }

  private renderReact(): void {
    if (!this.reactRoot) return;
    const file = this.file ?? null;
    this.reactRoot.render(<KmindObsidianViewApp file={file} hostApp={this.app} />);
  }
}
