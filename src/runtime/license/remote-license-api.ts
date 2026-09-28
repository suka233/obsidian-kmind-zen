import type { KmindZenLicenseEnvelopeV1 } from "./types";

type ApiOk<T> = { ok: true; result: T; serverTimeMs: number };
type ApiErr = { ok: false; error: { code: string; message: string } };
type ApiResponse<T> = ApiOk<T> | ApiErr;

export type ObsidianSessionPayload = {
  lease: KmindZenLicenseEnvelopeV1;
  refreshToken: KmindZenLicenseEnvelopeV1;
};

function joinUrl(base: string, path: string): string {
  const normalizedBase = String(base ?? "").trim().replace(/\/+$/, "");
  const normalizedPath = String(path ?? "").trim().replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
}

function resolveApiBase(): string {
  return String(__KMIND_ZEN_API_BASE__ ?? "").trim().replace(/\/+$/, "");
}

async function postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<ApiResponse<T>> {
  const base = resolveApiBase();
  if (!base) {
    return { ok: false, error: { code: "NO_API_BASE", message: "Missing API base." } };
  }

  const url = joinUrl(base, path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(200, timeoutMs));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
      credentials: "omit",
    });
    const text = await response.text();
    const parsed = (() => {
      try {
        return JSON.parse(text) as ApiResponse<T>;
      } catch {
        return null;
      }
    })();
    if (parsed && typeof parsed === "object" && "ok" in parsed) return parsed;
    return {
      ok: false,
      error: {
        code: response.ok ? "BAD_RESPONSE" : `HTTP_${response.status}`,
        message: text || "Request failed.",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = message.includes("aborted") || message.includes("AbortError");
    return {
      ok: false,
      error: {
        code: aborted ? "TIMEOUT" : "NETWORK",
        message: aborted ? "Request timed out." : message,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function apiActivateLicense(args: {
  licenseKey: string;
  email: string;
  devicePubKeyB64: string;
}): Promise<ApiResponse<ObsidianSessionPayload>> {
  return postJson<ObsidianSessionPayload>("/license/obsidian/activate", args, 5000);
}

export async function apiClaimTrial(args: {
  email: string;
  devicePubKeyB64: string;
}): Promise<ApiResponse<ObsidianSessionPayload>> {
  return postJson<ObsidianSessionPayload>("/license/obsidian/trial/claim", args, 5000);
}

export async function apiRefreshLicense(args: {
  refreshToken: KmindZenLicenseEnvelopeV1;
  devicePubKeyB64: string;
  proof: { nonce: string; signedAtMs: number; signatureB64: string };
}): Promise<ApiResponse<ObsidianSessionPayload>> {
  return postJson<ObsidianSessionPayload>("/license/obsidian/refresh", args, 2500);
}
