import { createPublicAppCapabilities, type AppCapabilities, type AppPremiumCapabilities, withPremiumCapabilities } from "@kmind/app";

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

export function createObsidianAppCapabilities(snapshot: KmindZenLicenseSnapshot | null | undefined): AppCapabilities {
  return withPremiumCapabilities(createPublicAppCapabilities(), resolveObsidianPremiumCapabilities(snapshot));
}
