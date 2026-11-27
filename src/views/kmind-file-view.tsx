import { FileView, Scope, type TFile, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import type { KeyCombo } from "@kmind/app";

import { KmindObsidianViewApp } from "../ui/kmind-obsidian-view-app";
import { createObsidianKeyClaims } from "./obsidian-key-claims";

export const VIEW_TYPE_KMIND = "kmind-zen-view";

/**
 * A map view. The runtime reads and writes the file itself, so the view is a plain `FileView`
 * (phase-25.9): Obsidian does not read the file for it on open or on every modification, and
 * keeps no copy of the file's text per pane.
 *
 * The view's own Obsidian scope claims the keys the map takes in whiteboard mode (phase-34.16): Obsidian's
 * hotkeys run before the view's window listener, so without a claim one press would also run an Obsidian
 * command bound to the same keys. A claim does not handle or prevent the key: KMind's own listeners still do.
 */
export class KmindFileView extends FileView {
  private reactRoot: Root | null = null;
  private readonly keyClaims: ReturnType<typeof createObsidianKeyClaims>;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    const scope = new Scope(this.app.scope);
    this.scope = scope;
    this.keyClaims = createObsidianKeyClaims(scope);
  }

  override getViewType(): string {
    return VIEW_TYPE_KMIND;
  }

  override getDisplayText(): string {
    return this.file?.basename ? `${this.file.basename}.kmindz` : "KMind";
  }

  override async onLoadFile(_file: TFile): Promise<void> {
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
    this.reactRoot = createRoot(container);
    this.renderReact();
  }

  override async onClose(): Promise<void> {
    this.claimHostKeys([]);
    try {
      this.reactRoot?.unmount();
    } finally {
      this.reactRoot = null;
    }
  }

  /** Makes `combos` the keys this view's scope claims (see `createObsidianKeyClaims`). */
  private readonly claimHostKeys = (combos: readonly KeyCombo[]): void => {
    this.keyClaims.claim(combos);
  };

  private renderReact(): void {
    if (!this.reactRoot) return;
    const file = this.file ?? null;
    this.reactRoot.render(<KmindObsidianViewApp file={file} hostApp={this.app} claimHostKeys={this.claimHostKeys} />);
  }
}
