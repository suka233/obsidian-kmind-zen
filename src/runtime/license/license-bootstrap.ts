import { apiRefreshLicense } from "./remote-license-api";
import { kmindZenObsidianLicenseStore } from "./license-store";

function createNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function bootstrapKmindZenObsidianLicense(): Promise<void> {
  try {
    await kmindZenObsidianLicenseStore.ensureLoaded();
  } catch (error) {
    console.warn("[kmind-zen] license bootstrap: ensureLoaded failed:", error);
    return;
  }

  const refreshToken = kmindZenObsidianLicenseStore.getRefreshToken();
  if (!refreshToken) return;

  const devicePubKeyB64 = kmindZenObsidianLicenseStore.getDevicePubKeyB64();
  if (!devicePubKeyB64) return;

  const proof = kmindZenObsidianLicenseStore.createRefreshProof({
    refreshToken,
    nonce: createNonce(),
    signedAtMs: Date.now(),
  });
  if (!proof) return;

  const res = await apiRefreshLicense({ refreshToken, devicePubKeyB64, proof });
  if (!res.ok) {
    const code = res.error.code;
    const shouldClear =
      code === "LICENSE_REVOKED" ||
      code === "BAD_LICENSE" ||
      code === "DEVICE_MISMATCH" ||
      code === "BAD_SESSION" ||
      code === "BAD_PROOF";
    if (shouldClear) {
      try {
        await kmindZenObsidianLicenseStore.clearSession();
      } catch (error) {
        console.warn("[kmind-zen] license bootstrap: clear session failed:", error);
      }
    }
    return;
  }

  try {
    await kmindZenObsidianLicenseStore.setSession(res.result);
  } catch (error) {
    console.warn("[kmind-zen] license bootstrap: persist refresh failed:", error);
  }
}
