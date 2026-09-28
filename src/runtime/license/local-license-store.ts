import nacl from "tweetnacl";

import type { KmindZenLicenseEnvelopeV1, KmindZenLocalLicenseStateV3 } from "./types";
import { bytesToBase64 } from "./base64";

const LICENSE_STORAGE_KEY = "kmind-zen:obsidian:local-license-v3";

const DEFAULT_STATE: Omit<KmindZenLocalLicenseStateV3, "device"> = {
  schema: "kmind-zen-obsidian-local-license@v3",
  updatedAtMs: 0,
  lastSeenAtMs: 0,
  lease: null,
  refreshToken: null,
};

function readLocalText(): string | null {
  try {
    return globalThis.localStorage?.getItem(LICENSE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLocalText(text: string): void {
  try {
    globalThis.localStorage?.setItem(LICENSE_STORAGE_KEY, text);
  } catch {
    // ignore
  }
}

function isValidKeyB64(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isEnvelope(value: unknown): value is KmindZenLicenseEnvelopeV1 {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<KmindZenLicenseEnvelopeV1>;
  return envelope.schema === "kmind-license-cert@v1"
    && typeof envelope.kid === "string"
    && envelope.kid.trim().length > 0
    && typeof envelope.payloadJson === "string"
    && envelope.payloadJson.trim().length > 0
    && typeof envelope.signatureB64 === "string"
    && envelope.signatureB64.trim().length > 0;
}

function generateDeviceKeyPair(nowMs: number): KmindZenLocalLicenseStateV3["device"] {
  const pair = nacl.sign.keyPair();
  return {
    schema: "kmind-zen-device@v1",
    createdAtMs: nowMs,
    publicKeyB64: bytesToBase64(pair.publicKey),
    secretKeyB64: bytesToBase64(pair.secretKey),
  };
}

function parseState(text: string): KmindZenLocalLicenseStateV3 | null {
  try {
    const value = JSON.parse(text) as Partial<KmindZenLocalLicenseStateV3> | null;
    if (!value || value.schema !== "kmind-zen-obsidian-local-license@v3") return null;

    const device = value.device as Partial<KmindZenLocalLicenseStateV3["device"]> | null | undefined;
    if (!device || device.schema !== "kmind-zen-device@v1") return null;
    if (!isValidKeyB64(device.publicKeyB64) || !isValidKeyB64(device.secretKeyB64)) return null;

    const createdAtMs = typeof device.createdAtMs === "number" && Number.isFinite(device.createdAtMs) ? device.createdAtMs : 0;
    const lastSeenAtMs = typeof value.lastSeenAtMs === "number" && Number.isFinite(value.lastSeenAtMs) ? value.lastSeenAtMs : 0;
    const lease = isEnvelope(value.lease) ? value.lease : null;
    const refreshToken = isEnvelope(value.refreshToken) ? value.refreshToken : null;

    return {
      schema: "kmind-zen-obsidian-local-license@v3",
      updatedAtMs: typeof value.updatedAtMs === "number" && Number.isFinite(value.updatedAtMs) ? value.updatedAtMs : 0,
      device: {
        schema: "kmind-zen-device@v1",
        createdAtMs,
        publicKeyB64: String(device.publicKeyB64).trim(),
        secretKeyB64: String(device.secretKeyB64).trim(),
      },
      lastSeenAtMs,
      lease,
      refreshToken,
    };
  } catch {
    return null;
  }
}

export async function loadOrCreateLocalLicenseState(): Promise<KmindZenLocalLicenseStateV3> {
  const text = readLocalText();
  if (text) {
    const parsed = parseState(text);
    if (parsed) return parsed;
  }

  const nowMs = Date.now();
  const created: KmindZenLocalLicenseStateV3 = {
    ...DEFAULT_STATE,
    updatedAtMs: nowMs,
    lastSeenAtMs: nowMs,
    device: generateDeviceKeyPair(nowMs),
  };
  writeLocalText(JSON.stringify(created));
  return created;
}

export async function persistLocalLicenseState(next: KmindZenLocalLicenseStateV3): Promise<void> {
  const updatedAtMs = Date.now();
  writeLocalText(JSON.stringify({ ...next, updatedAtMs }));
}
