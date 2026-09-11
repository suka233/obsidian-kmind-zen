export type KmindZenLicensePlan = "trial" | "subscription" | "perpetual";
export type KmindZenLicenseProduct = "obsidian_plugin";
export type KmindZenLicenseTier = "free" | "pro";

export type KmindZenLicenseEnvelopeV1 = {
  schema: "kmind-license-cert@v1";
  kid: string;
  payloadJson: string;
  signatureB64: string;
};

export type KmindZenObsidianLeasePayloadV1 = {
  schema: "kmind-obsidian-lease@v1";
  licenseId: string;
  product: KmindZenLicenseProduct;
  plan: KmindZenLicensePlan;
  tier: "pro";
  entitlements: string[];
  issuedAtMs: number;
  leaseExpiresAtMs: number;
  expiresAtMs?: number;
  seatLimit: number;
  devicePubKeyB64: string;
};

export type KmindZenObsidianRefreshTokenPayloadV1 = {
  schema: "kmind-obsidian-refresh-token@v1";
  licenseId: string;
  product: KmindZenLicenseProduct;
  issuedAtMs: number;
  expiresAtMs: number;
  devicePubKeyB64: string;
};

export type KmindZenLocalLicenseStateV3 = {
  schema: "kmind-zen-obsidian-local-license@v3";
  updatedAtMs: number;
  device: {
    schema: "kmind-zen-device@v1";
    createdAtMs: number;
    publicKeyB64: string;
    secretKeyB64: string;
  };
  lastSeenAtMs: number;
  lease: KmindZenLicenseEnvelopeV1 | null;
  refreshToken: KmindZenLicenseEnvelopeV1 | null;
};

export type KmindZenLicenseStatus = "none" | "active" | "expired" | "invalid";

export type KmindZenLicenseCapabilities = {
  tier: KmindZenLicenseTier;
  canUseBasicEditing: true;
  canCreateBacklinks: boolean;
  canInsertFormula: boolean;
  canInsertCloze: boolean;
  canCreateComments: boolean;
  canPinHistory: boolean;
  canRenameHistoryPin: boolean;
  canUseFoundersLimitedIcons: boolean;
};

export type KmindZenLicenseSnapshot = {
  status: KmindZenLicenseStatus;
  reason: string | null;
  payload: KmindZenObsidianLeasePayloadV1 | null;
  effectiveNowMs: number;
  lastSeenAtMs: number;
  timeBackwardsMs: number;
  capabilities: KmindZenLicenseCapabilities;
  devicePubKeyB64: string;
};
