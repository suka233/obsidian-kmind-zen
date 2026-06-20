import type { KmindZenLicenseSnapshot } from "./types";

export function formatKmindZenLicensePlanLabel(
  payload: KmindZenLicenseSnapshot["payload"],
  emptyLabel: string,
): string {
  if (!payload) return emptyLabel;
  if (payload.entitlements.includes("founders_pass_identity")) return "Founders Pass";
  return payload.plan;
}
