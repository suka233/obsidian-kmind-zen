import { getLanguage } from "obsidian";
import { KMIND_APP_MESSAGES } from "@kmind/app";
import { KMIND_REACT_MESSAGES } from "@kmind/editor-react";
import { createI18n, mergeMessagesByLocale } from "@kmind/i18n";

import { KMIND_OBSIDIAN_UI_MESSAGES } from "./messages";

export function resolveObsidianLocale(): string {
  const appLang = typeof getLanguage === "function" ? String(getLanguage() ?? "").trim() : "";
  if (appLang) return appLang;
  const lang = String(globalThis.navigator?.language ?? "").trim();
  if (lang) return lang;
  return "en-US";
}

export function createObsidianUiI18n() {
  return createI18n({
    locale: resolveObsidianLocale(),
    fallbackLocale: "zh-CN",
    messagesByLocale: mergeMessagesByLocale(KMIND_APP_MESSAGES, KMIND_REACT_MESSAGES, KMIND_OBSIDIAN_UI_MESSAGES),
    missingKeyStrategy: "key",
  });
}
