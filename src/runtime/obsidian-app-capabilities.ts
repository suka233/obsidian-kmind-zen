import { ALL_LAYOUT_TYPES, createPublicAppCapabilities, type AppCapabilities, type AppPremiumCapabilities, withPremiumCapabilities } from "@kmind/app";

import type { KmindZenLicenseSnapshot } from "./license/types";

export function resolveObsidianPremiumCapabilities(snapshot: KmindZenLicenseSnapshot | null | undefined): AppPremiumCapabilities {
  const isPro = snapshot?.status === "active" && snapshot.capabilities.tier === "pro";
  const canUseFoundersLimitedIcons = Boolean(snapshot?.capabilities.canUseFoundersLimitedIcons);
  return {
    tier: isPro ? "pro" : "free",
    canCreateBacklinks: isPro,
    canInsertFormula: isPro,
    canInsertCloze: isPro,
    canCreateComments: isPro,
    canPinHistory: isPro,
    canRenameHistoryPin: isPro,
    canCreateManualCheckpoint: isPro,
    canAddTodo: isPro,
    canCreateDoctreeMap: false,
    canInsertSiyuanDocLink: isPro,
    canImportSiyuanDocByDrag: false,
    canImportSiyuanBlockByDrag: false,
    canUseMirrorBlock: false,
    canCreateSiyuanNodeSubdoc: false,
    canUseFoundersLimitedIcons,
  };
}

/** Obsidian offers the whiteboard (phase-34.15, Mission decision 2); the plugin loads on the desktop only. */
export const KMIND_OBSIDIAN_WHITEBOARD_ENABLED = true;

export function createObsidianAppCapabilities(snapshot: KmindZenLicenseSnapshot | null | undefined): AppCapabilities {
  const capabilities = createPublicAppCapabilities({ whiteboardEnabled: KMIND_OBSIDIAN_WHITEBOARD_ENABLED });
  capabilities.layout.rootLayoutAllowlist = [...ALL_LAYOUT_TYPES];
  return withPremiumCapabilities(capabilities, resolveObsidianPremiumCapabilities(snapshot));
}
