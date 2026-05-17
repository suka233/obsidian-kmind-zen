import nacl from "tweetnacl";

import type { KmindZenLicenseEnvelopeV1, KmindZenLicenseSnapshot, KmindZenObsidianLeasePayloadV1 } from "./types";
import type { TrustedPublicKeys } from "./trusted-public-keys";
import { base64ToBytes } from "./base64";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseEnvelope(value: unknown): KmindZenLicenseEnvelopeV1 | null {
  if (!value || typeof value !== "object") return null;
  const cert = value as Partial<KmindZenLicenseEnvelopeV1>;
  if (cert.schema !== "kmind-license-cert@v1") return null;
  if (typeof cert.kid !== "string" || !cert.kid.trim()) return null;
  if (typeof cert.payloadJson !== "string" || !cert.payloadJson.trim()) return null;
  if (typeof cert.signatureB64 !== "string" || !cert.signatureB64.trim()) return null;
  return {
    schema: "kmind-license-cert@v1",
    kid: cert.kid.trim(),
    payloadJson: cert.payloadJson,
    signatureB64: cert.signatureB64.trim(),
  };
}

function parsePayloadFromJson(payloadJson: string): KmindZenObsidianLeasePayloadV1 | null {
  try {
    const parsed = JSON.parse(payloadJson) as Partial<KmindZenObsidianLeasePayloadV1> | null;
    if (!parsed || parsed.schema !== "kmind-obsidian-lease@v1") return null;
    if (typeof parsed.licenseId !== "string" || !parsed.licenseId.trim()) return null;
    if (parsed.product !== "obsidian_plugin") return null;
    if (parsed.plan !== "trial" && parsed.plan !== "subscription" && parsed.plan !== "perpetual") return null;
    if (parsed.tier !== "pro") return null;
    if (!isFiniteNumber(parsed.issuedAtMs)) return null;
    if (!isFiniteNumber(parsed.leaseExpiresAtMs)) return null;
    if (!isFiniteNumber(parsed.seatLimit)) return null;
    if (typeof parsed.devicePubKeyB64 !== "string" || !parsed.devicePubKeyB64.trim()) return null;
    if (parsed.expiresAtMs != null && !isFiniteNumber(parsed.expiresAtMs)) return null;

    return {
      schema: "kmind-obsidian-lease@v1",
      licenseId: parsed.licenseId.trim(),
      product: "obsidian_plugin",
      plan: parsed.plan,
      tier: "pro",
      issuedAtMs: parsed.issuedAtMs,
      leaseExpiresAtMs: parsed.leaseExpiresAtMs,
      ...(parsed.expiresAtMs != null ? { expiresAtMs: parsed.expiresAtMs } : null),
      seatLimit: parsed.seatLimit,
      devicePubKeyB64: parsed.devicePubKeyB64.trim(),
    };
  } catch {
    return null;
  }
}

function computeEffectiveNow(args: { nowMs: number; lastSeenAtMs: number }): {
  effectiveNowMs: number;
  nextLastSeenAtMs: number;
  timeBackwardsMs: number;
} {
  const last = isFiniteNumber(args.lastSeenAtMs) ? args.lastSeenAtMs : 0;
  const now = isFiniteNumber(args.nowMs) ? args.nowMs : 0;
  const effectiveNowMs = Math.max(now, last);
  const timeBackwardsMs = last > now ? last - now : 0;
  return { effectiveNowMs, nextLastSeenAtMs: effectiveNowMs, timeBackwardsMs };
}

function createCapabilities(isPro: boolean): KmindZenLicenseSnapshot["capabilities"] {
  return {
    tier: isPro ? "pro" : "free",
    canUseBasicEditing: true,
    canCreateBacklinks: isPro,
    canInsertFormula: isPro,
    canInsertCloze: isPro,
    canCreateComments: isPro,
    canPinHistory: isPro,
    canRenameHistoryPin: isPro,
  };
}

export function evaluateLicenseSnapshot(args: {
  lease: unknown;
  trustedPublicKeys: TrustedPublicKeys;
  devicePubKeyB64: string;
  lastSeenAtMs: number;
}): KmindZenLicenseSnapshot {
  const nowMs = Date.now();
  const { effectiveNowMs, nextLastSeenAtMs, timeBackwardsMs } = computeEffectiveNow({
    nowMs,
    lastSeenAtMs: args.lastSeenAtMs,
  });

  const base: Omit<KmindZenLicenseSnapshot, "status" | "reason" | "payload" | "capabilities"> = {
    effectiveNowMs,
    lastSeenAtMs: nextLastSeenAtMs,
    timeBackwardsMs,
    devicePubKeyB64: args.devicePubKeyB64,
  };

  const lease = parseEnvelope(args.lease);
  if (!lease) {
    return {
      ...base,
      status: "none",
      reason: null,
      payload: null,
      capabilities: createCapabilities(false),
    };
  }

  const pubKeyB64 = args.trustedPublicKeys[lease.kid];
  if (!pubKeyB64) {
    return {
      ...base,
      status: "invalid",
      reason: `unknown_kid:${lease.kid}`,
      payload: null,
      capabilities: createCapabilities(false),
    };
  }

  const pubKey = base64ToBytes(pubKeyB64);
  const signature = base64ToBytes(lease.signatureB64);
  const message = new TextEncoder().encode(lease.payloadJson);
  const ok = nacl.sign.detached.verify(message, signature, pubKey);
  if (!ok) {
    return {
      ...base,
      status: "invalid",
      reason: "bad_signature",
      payload: null,
      capabilities: createCapabilities(false),
    };
  }

  const payload = parsePayloadFromJson(lease.payloadJson);
  if (!payload) {
    return {
      ...base,
      status: "invalid",
      reason: "bad_payload",
      payload: null,
      capabilities: createCapabilities(false),
    };
  }

  if (payload.devicePubKeyB64 !== args.devicePubKeyB64) {
    return {
      ...base,
      status: "invalid",
      reason: "device_mismatch",
      payload,
      capabilities: createCapabilities(false),
    };
  }

  if (effectiveNowMs > payload.leaseExpiresAtMs) {
    return {
      ...base,
      status: "expired",
      reason: "lease_expired",
      payload,
      capabilities: createCapabilities(false),
    };
  }

  if (payload.plan !== "perpetual") {
    if (!isFiniteNumber(payload.expiresAtMs)) {
      return {
        ...base,
        status: "invalid",
        reason: "missing_expiresAtMs",
        payload,
        capabilities: createCapabilities(false),
      };
    }
    if (effectiveNowMs > payload.expiresAtMs) {
      return {
        ...base,
        status: "expired",
        reason: null,
        payload,
        capabilities: createCapabilities(false),
      };
    }
  }

  return {
    ...base,
    status: "active",
    reason: null,
    payload,
    capabilities: createCapabilities(true),
  };
}
