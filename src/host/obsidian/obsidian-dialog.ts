import { Modal, Setting, type App } from "obsidian";

import type { DialogPort } from "@kmind/app";

type ConfirmArgs = {
  title?: string | undefined;
  message: string;
  okLabel?: string | undefined;
  cancelLabel?: string | undefined;
};

type PromptArgs = {
  title?: string | undefined;
  message: string;
  initialValue?: string | undefined;
  okLabel?: string | undefined;
  cancelLabel?: string | undefined;
};

class ConfirmModal extends Modal {
  private resolved = false;
  private resolveFn: (value: boolean) => void;
  private args: ConfirmArgs;

  constructor(app: App, args: ConfirmArgs, resolve: (value: boolean) => void) {
    super(app);
    this.args = args;
    this.resolveFn = resolve;
  }

  override onOpen(): void {
    const title = this.args.title?.trim();
    if (title) this.titleEl.setText(title);

    this.contentEl.createEl("p", { text: this.args.message });

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText(this.args.okLabel ?? "OK");
        btn.setCta();
        btn.onClick(() => this.finish(true));
      })
      .addButton((btn) => {
        btn.setButtonText(this.args.cancelLabel ?? "Cancel");
        btn.onClick(() => this.finish(false));
      });
  }

  override onClose(): void {
    if (!this.resolved) this.finish(false);
    this.contentEl.empty();
  }

  private finish(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn(value);
    this.close();
  }
}

class PromptModal extends Modal {
  private resolved = false;
  private resolveFn: (value: string | null) => void;
  private args: PromptArgs;
  private inputEl: HTMLInputElement | null = null;

  constructor(app: App, args: PromptArgs, resolve: (value: string | null) => void) {
    super(app);
    this.args = args;
    this.resolveFn = resolve;
  }

  override onOpen(): void {
    const title = this.args.title?.trim();
    if (title) this.titleEl.setText(title);

    this.contentEl.createEl("p", { text: this.args.message });
    const input = this.contentEl.createEl("input", { type: "text" });
    input.value = this.args.initialValue ?? "";
    input.style.width = "100%";
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.finish(input.value);
      if (event.key === "Escape") this.finish(null);
    });
    this.inputEl = input;

    new Setting(this.contentEl)
      .addButton((btn) => {
        btn.setButtonText(this.args.okLabel ?? "OK");
        btn.setCta();
        btn.onClick(() => this.finish(input.value));
      })
      .addButton((btn) => {
        btn.setButtonText(this.args.cancelLabel ?? "Cancel");
        btn.onClick(() => this.finish(null));
      });

    queueMicrotask(() => input.focus());
  }

  override onClose(): void {
    if (!this.resolved) this.finish(null);
    this.inputEl = null;
    this.contentEl.empty();
  }

  private finish(value: string | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn(value);
    this.close();
  }
}

export function createObsidianDialogPort(app: App): DialogPort {
  return {
    async alert(message) {
      await new Promise<void>((resolve) => {
        const modal = new ConfirmModal(app, { title: "KMind", message, okLabel: "OK", cancelLabel: "" }, () => resolve());
        modal.open();
      });
    },
    async confirm(message) {
      return new Promise<boolean>((resolve) => {
        const modal = new ConfirmModal(app, { title: "KMind", message, okLabel: "OK", cancelLabel: "Cancel" }, resolve);
        modal.open();
      });
    },
    async prompt(args) {
      return new Promise<string | null>((resolve) => {
        const modal = new PromptModal(
          app,
          {
            title: args.title ?? "KMind",
            message: args.message,
            initialValue: args.initialValue,
            okLabel: "OK",
            cancelLabel: "Cancel",
          },
          resolve,
        );
        modal.open();
      });
    },
  };
}
