import nacl from "tweetnacl";

import type { KmindZenLicenseEnvelopeV1, KmindZenLicenseSnapshot, KmindZenLocalLicenseStateV3 } from "./types";
import { loadOrCreateLocalLicenseState, persistLocalLicenseState } from "./local-license-store";
import { evaluateLicenseSnapshot } from "./license-evaluator";
import { resolveTrustedPublicKeys } from "./trusted-public-keys";
import { base64ToBytes, bytesToBase64 } from "./base64";

let localState: KmindZenLocalLicenseStateV3 | null = null;
let snapshot: KmindZenLicenseSnapshot | null = null;
const listeners = new Set<() => void>();
let loadPromise: Promise<void> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function createFreeSnapshot(): KmindZenLicenseSnapshot {
  const now = Date.now();
  return {
    status: "none",
    reason: null,
    payload: null,
    effectiveNowMs: now,
    lastSeenAtMs: now,
    timeBackwardsMs: 0,
    capabilities: {
      tier: "free",
      canUseBasicEditing: true,
      canCreateBacklinks: false,
      canInsertFormula: false,
      canInsertCloze: false,
      canCreateComments: false,
      canPinHistory: false,
      canRenameHistoryPin: false,
    },
    devicePubKeyB64: localState?.device.publicKeyB64 ?? "",
  };
}

function recomputeSnapshot(): KmindZenLicenseSnapshot {
  const state = localState;
  if (!state) return createFreeSnapshot();

  return evaluateLicenseSnapshot({
    lease: state.lease,
    trustedPublicKeys: resolveTrustedPublicKeys(),
    devicePubKeyB64: state.device.publicKeyB64,
    lastSeenAtMs: state.lastSeenAtMs,
  });
}

async function persistState(reason: string): Promise<void> {
  if (!localState) return;
  try {
    await persistLocalLicenseState(localState);
  } catch (error) {
    console.warn("[kmind-zen] persist license state failed:", reason, error);
  }
}

async function loadOnce(): Promise<void> {
  localState = await loadOrCreateLocalLicenseState();
  snapshot = recomputeSnapshot();

  if (snapshot && localState && snapshot.lastSeenAtMs !== localState.lastSeenAtMs) {
    localState = { ...localState, lastSeenAtMs: snapshot.lastSeenAtMs, updatedAtMs: Date.now() };
    await persistState("bump-lastSeen");
  }

  emit();
}

export const kmindZenObsidianLicenseStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): KmindZenLicenseSnapshot {
    if (snapshot) return snapshot;
    return recomputeSnapshot();
  },
  async ensureLoaded() {
    if (!loadPromise) loadPromise = loadOnce();
    await loadPromise;
  },
  getDevicePubKeyB64(): string {
    return localState?.device.publicKeyB64 ?? "";
  },
  getLease(): KmindZenLicenseEnvelopeV1 | null {
    return localState?.lease ?? null;
  },
  getRefreshToken(): KmindZenLicenseEnvelopeV1 | null {
    return localState?.refreshToken ?? null;
  },
  createRefreshProof(args: { refreshToken: KmindZenLicenseEnvelopeV1; nonce: string; signedAtMs: number }) {
    const secretKeyB64 = localState?.device.secretKeyB64 ?? "";
    if (!secretKeyB64) return null;
    const secretKey = base64ToBytes(secretKeyB64);
    const message = new TextEncoder().encode(`${args.refreshToken.payloadJson}\n${args.signedAtMs}\n${args.nonce}`);
    const signature = nacl.sign.detached(message, secretKey);
    return {
      nonce: args.nonce,
      signedAtMs: args.signedAtMs,
      signatureB64: bytesToBase64(signature),
    };
  },
  async setSession(args: { lease: KmindZenLicenseEnvelopeV1 | null; refreshToken: KmindZenLicenseEnvelopeV1 | null }) {
    await this.ensureLoaded();
    if (!localState) return;
    localState = { ...localState, lease: args.lease, refreshToken: args.refreshToken, updatedAtMs: Date.now() };
    snapshot = recomputeSnapshot();
    emit();
    await persistState("set-session");
  },
  async clearSession() {
    await this.setSession({ lease: null, refreshToken: null });
  },
  async bumpLastSeen() {
    await this.ensureLoaded();
    if (!localState) return;
    snapshot = recomputeSnapshot();
    if (!snapshot) return;
    if (snapshot.lastSeenAtMs === localState.lastSeenAtMs) return;
    localState = { ...localState, lastSeenAtMs: snapshot.lastSeenAtMs, updatedAtMs: Date.now() };
    emit();
    await persistState("bump-lastSeen");
  },
};
