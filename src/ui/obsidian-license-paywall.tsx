import { Notice } from "obsidian";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useT } from "@kmind/editor-react";

import { resolveObsidianLocale } from "../i18n/ui-i18n";
import type { KmindZenLicenseSnapshot } from "../runtime/license/types";
import { bootstrapKmindZenObsidianLicense } from "../runtime/license/license-bootstrap";
import { kmindZenObsidianLicenseStore } from "../runtime/license/license-store";
import { apiActivateLicense, apiClaimTrial } from "../runtime/license/remote-license-api";
import {
  apiCreatePurchaseSession,
  apiGetPaywallScene,
  apiGetPurchaseSession,
  apiQuotePaywallScene,
  type ObsidianPaywallScene,
  type ObsidianPurchaseSessionSnapshot,
} from "../runtime/license/remote-purchase-api";

const PURCHASE_POLL_WINDOW_MS = 5 * 60 * 1000;
const PURCHASE_POLL_BACKOFF_MS = [0, 1500, 2500, 4000, 6000, 9000, 12000, 15000];

function formatStatusHint(
  t: (key: string, params?: Record<string, unknown> | undefined) => string,
  snapshot: KmindZenLicenseSnapshot,
): string {
  if (snapshot.status === "active") return t("obsidian.paywall.status.active");
  if (snapshot.status === "expired") return t("obsidian.paywall.status.expired");
  if (snapshot.status === "invalid") return t("obsidian.paywall.status.invalid");
  return t("obsidian.paywall.status.none");
}

function normalizeEmail(value: string): string {
  return String(value ?? "").trim().replaceAll(/\s+/g, "").toLowerCase();
}

function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= 254 && email.includes("@");
}

function normalizeLicenseKey(value: string): string {
  return String(value ?? "").trim().replaceAll(/\s+/g, "").toUpperCase();
}

function normalizeCouponCode(value: string): string {
  return String(value ?? "").trim().replaceAll(/\s+/g, "").toUpperCase();
}

function formatExpiresAt(
  t: (key: string, params?: Record<string, unknown> | undefined) => string,
  payload: KmindZenLicenseSnapshot["payload"],
): string {
  if (!payload) return t("kmind.common.emptyDash");
  if (payload.plan === "perpetual") return t("obsidian.settings.license.expires.never");
  if (!payload.expiresAtMs) return t("kmind.common.emptyDash");
  try {
    return new Date(payload.expiresAtMs).toLocaleString();
  } catch {
    return String(payload.expiresAtMs);
  }
}

function providerLabel(provider: string): string {
  if (provider === "wechat_qr") return "obsidian.paywall.provider.wechatQr";
  if (provider === "alipay_qr") return "obsidian.paywall.provider.alipayQr";
  if (provider === "stripe_checkout") return "obsidian.paywall.provider.stripeCheckout";
  return provider;
}

function formatPrice(args: { amountCents: number; currency: string; locale: string }): string {
  try {
    return new Intl.NumberFormat(args.locale, {
      style: "currency",
      currency: args.currency,
      maximumFractionDigits: 2,
    }).format(args.amountCents / 100);
  } catch {
    return `${(args.amountCents / 100).toFixed(2)} ${args.currency}`;
  }
}

function shouldPollPurchaseSession(status: string | null | undefined): boolean {
  return status === "pending_payment" || status === "payment_processing";
}

function resetPurchasePollState(current: {
  lastCheckedAtMs: number | null;
  paused: boolean;
}) {
  if (!current.paused) return current;
  return {
    ...current,
    paused: false,
  };
}

function pausePurchasePollState(current: {
  lastCheckedAtMs: number | null;
  paused: boolean;
}) {
  if (current.paused) return current;
  return {
    ...current,
    paused: true,
  };
}

export function ObsidianLicensePaywall(props?: {
  initialPurchaseOpen?: boolean | undefined;
  onPurchaseSuccess?: (() => void) | undefined;
}) {
  const t = useT();
  const snapshot = useSyncExternalStore(
    kmindZenObsidianLicenseStore.subscribe,
    kmindZenObsidianLicenseStore.getSnapshot,
    kmindZenObsidianLicenseStore.getSnapshot,
  );
  const [email, setEmail] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(Boolean(props?.initialPurchaseOpen));
  const [scene, setScene] = useState<ObsidianPaywallScene | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [purchaseSession, setPurchaseSession] = useState<ObsidianPurchaseSessionSnapshot | null>(null);
  const [appliedPurchaseSessionId, setAppliedPurchaseSessionId] = useState<string | null>(null);
  const [purchasePollState, setPurchasePollState] = useState<{
    lastCheckedAtMs: number | null;
    paused: boolean;
  }>({
    lastCheckedAtMs: null,
    paused: false,
  });
  const pollStartedAtRef = useRef<number | null>(null);
  const pollAttemptRef = useRef(0);

  const expiresAtText = useMemo(() => formatExpiresAt(t, snapshot.payload), [snapshot.payload, t]);
  const shouldPollSession = useMemo(
    () => shouldPollPurchaseSession(purchaseSession?.status),
    [purchaseSession?.status],
  );
  const lastPurchaseCheckText = useMemo(() => {
    if (!purchasePollState.lastCheckedAtMs) return null;
    try {
      return new Date(purchasePollState.lastCheckedAtMs).toLocaleTimeString();
    } catch {
      return null;
    }
  }, [purchasePollState.lastCheckedAtMs]);
  const deviceHint = useMemo(() => {
    const key = snapshot.devicePubKeyB64 || kmindZenObsidianLicenseStore.getDevicePubKeyB64();
    if (!key) return t("kmind.common.emptyDash");
    return `${key.slice(0, 10)}…${key.slice(-6)}`;
  }, [snapshot.devicePubKeyB64, t]);
  const purchaseLocale = useMemo(() => resolveObsidianLocale(), []);

  useEffect(() => {
    if (!purchaseOpen || scene) return;
    let cancelled = false;
    void apiGetPaywallScene({ sceneKey: "obsidian_plugin_default", surface: "obsidian_plugin", locale: purchaseLocale }).then((res) => {
      if (cancelled || !res.ok) return;
      setScene(res.result);
    });
    return () => {
      cancelled = true;
    };
  }, [purchaseLocale, purchaseOpen, scene]);

  const pollPurchaseSession = useCallback(async (sessionId: string) => {
    const res = await apiGetPurchaseSession(sessionId);
    startTransition(() => {
      setPurchasePollState((current) => ({
        ...current,
        lastCheckedAtMs: Date.now(),
      }));
    });
    if (!res.ok) return false;
    startTransition(() => {
      setPurchaseSession(res.result);
      setError(null);
    });
    return true;
  }, []);

  useEffect(() => {
    if (!purchaseSession || !shouldPollSession) {
      pollStartedAtRef.current = null;
      pollAttemptRef.current = 0;
      setPurchasePollState(resetPurchasePollState);
      return () => {};
    }

    let cancelled = false;
    let timer: number | null = null;
    if (pollStartedAtRef.current == null) {
      pollStartedAtRef.current = Date.now();
      pollAttemptRef.current = 0;
    }

    const clearTimer = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const startedAt = pollStartedAtRef.current ?? Date.now();
      if (Date.now() - startedAt >= PURCHASE_POLL_WINDOW_MS) {
        startTransition(() => {
          setPurchasePollState(pausePurchasePollState);
        });
        return;
      }
      const delay =
        PURCHASE_POLL_BACKOFF_MS[Math.min(pollAttemptRef.current, PURCHASE_POLL_BACKOFF_MS.length - 1)] ??
        15000;
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        if (document.visibilityState === "hidden") {
          scheduleNext();
          return;
        }
        try {
          const ok = await pollPurchaseSession(purchaseSession.id);
          if (!ok && !cancelled) {
            startTransition(() => {
              setError(t("obsidian.paywall.purchase.pollingRequestFailed"));
            });
          }
        } catch (nextError) {
          if (!cancelled) {
            startTransition(() => {
              setError(nextError instanceof Error ? nextError.message : String(nextError));
            });
          }
        }
        pollAttemptRef.current += 1;
        scheduleNext();
      }, delay);
    };

    startTransition(() => {
      setPurchasePollState(resetPurchasePollState);
    });
    scheduleNext();
    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [pollPurchaseSession, purchaseSession?.id, shouldPollSession, t]);

  useEffect(() => {
    if (!purchaseSession) return;
    if (purchaseSession.status !== "fulfilled") return;
    if (appliedPurchaseSessionId === purchaseSession.id) return;
    if (purchaseSession.result?.kind !== "obsidian_plugin") return;

    void kmindZenObsidianLicenseStore
      .setSession({
        lease: purchaseSession.result.lease,
        refreshToken: purchaseSession.result.refreshToken,
      })
      .then(() => {
        setAppliedPurchaseSessionId(purchaseSession.id);
        new Notice(t("obsidian.notice.purchaseUnlocked"), 2500);
        props?.onPurchaseSuccess?.();
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
  }, [appliedPurchaseSessionId, props, purchaseSession]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || t("obsidian.error.unknown"));
    } finally {
      setBusy(false);
    }
  }

  async function applyCoupon() {
    if (!purchaseOpen) return;
    setCouponBusy(true);
    setError(null);
    try {
      const normalizedEmail = normalizeEmail(email);
      const normalizedCoupon = normalizeCouponCode(couponCode);
      const res = normalizedCoupon
        ? await apiQuotePaywallScene({
            sceneKey: "obsidian_plugin_default",
            surface: "obsidian_plugin",
            locale: purchaseLocale,
            couponCode: normalizedCoupon,
            buyerEmail: isValidEmail(normalizedEmail) ? normalizedEmail : undefined,
          })
        : await apiGetPaywallScene({
            sceneKey: "obsidian_plugin_default",
            surface: "obsidian_plugin",
            locale: purchaseLocale,
          });
      if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
      setScene(res.result);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setCouponBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 680, maxWidth: "calc(100% - 32px)", borderRadius: 16, padding: 16, border: "1px solid rgba(148,163,184,.35)" }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{t("obsidian.paywall.title")}</div>
        <div style={{ marginTop: 6, fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
          {formatStatusHint(t, snapshot)} · {t("obsidian.paywall.statusLine.plan")}:{" "}
          <span style={{ fontFamily: "monospace" }}>{snapshot.payload?.plan ?? t("kmind.common.emptyDash")}</span>
          {" · "}{t("obsidian.paywall.statusLine.expires")}: <span style={{ fontFamily: "monospace" }}>{expiresAtText}</span>
          {" · "}{t("obsidian.paywall.statusLine.device")}: <span style={{ fontFamily: "monospace" }}>{deviceHint}</span>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#475569" }}>{t("obsidian.paywall.field.email.label")}</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("obsidian.paywall.field.email.placeholder")}
              style={{ height: 36, borderRadius: 10, padding: "0 10px", border: "1px solid rgba(148,163,184,.35)", background: "transparent" }}
              disabled={busy}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#475569" }}>{t("obsidian.paywall.field.key.label")}</div>
            <input
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder={t("obsidian.paywall.field.key.placeholder")}
              style={{ height: 36, borderRadius: 10, padding: "0 10px", border: "1px solid rgba(148,163,184,.35)", background: "transparent", fontFamily: "monospace" }}
              disabled={busy}
            />
          </label>
        </div>

        {error ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c", whiteSpace: "pre-wrap" }}>
            {error}
          </div>
        ) : null}

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            disabled={busy}
            onClick={() => run(async () => {
              const normalizedEmail = normalizeEmail(email);
              if (!isValidEmail(normalizedEmail)) throw new Error(t("obsidian.error.invalidEmail"));
              await kmindZenObsidianLicenseStore.ensureLoaded();
              const devicePubKeyB64 = kmindZenObsidianLicenseStore.getDevicePubKeyB64();
              if (!devicePubKeyB64) throw new Error(t("obsidian.error.deviceKeyMissing"));

              const res = await apiClaimTrial({ email: normalizedEmail, devicePubKeyB64 });
              if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
              await kmindZenObsidianLicenseStore.setSession(res.result);
              new Notice(t("obsidian.notice.trialActivated"), 2500);
            })}
            style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.35)" }}
          >
            {busy ? "…" : t("obsidian.paywall.button.startTrial")}
          </button>

          <button
            disabled={busy}
            onClick={() => run(async () => {
              const normalizedEmail = normalizeEmail(email);
              if (!isValidEmail(normalizedEmail)) throw new Error(t("obsidian.error.invalidEmail"));
              const normalizedKey = normalizeLicenseKey(licenseKey);
              if (!normalizedKey) throw new Error(t("obsidian.error.missingActivationKey"));

              await kmindZenObsidianLicenseStore.ensureLoaded();
              const devicePubKeyB64 = kmindZenObsidianLicenseStore.getDevicePubKeyB64();
              if (!devicePubKeyB64) throw new Error(t("obsidian.error.deviceKeyMissing"));

              const res = await apiActivateLicense({
                licenseKey: normalizedKey,
                email: normalizedEmail,
                devicePubKeyB64,
              });
              if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
              await kmindZenObsidianLicenseStore.setSession(res.result);
              new Notice(t("obsidian.notice.activated"), 2500);
            })}
            style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.35)" }}
          >
            {busy ? "…" : t("obsidian.paywall.button.activate")}
          </button>

          <button
            disabled={busy}
            onClick={() => run(async () => {
              await bootstrapKmindZenObsidianLicense();
              new Notice(t("obsidian.notice.refreshed"), 1800);
            })}
            style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.35)" }}
          >
            {t("obsidian.paywall.button.refresh")}
          </button>

          <button
            disabled={busy}
            onClick={() => run(async () => {
              await kmindZenObsidianLicenseStore.clearSession();
              new Notice(t("obsidian.notice.localCleared"), 1800);
            })}
            style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.35)" }}
          >
            {t("obsidian.paywall.button.clearLocal")}
          </button>

          <button
            disabled={busy}
            onClick={() => setPurchaseOpen((value) => !value)}
            style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.35)" }}
          >
            {purchaseOpen ? t("obsidian.paywall.button.hidePurchase") : t("obsidian.paywall.button.buy")}
          </button>
        </div>

        {purchaseOpen ? (
          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 8, borderRadius: 14, border: "1px solid rgba(148,163,184,.28)", padding: 12 }}>
              <div style={{ fontSize: 12, color: "#475569" }}>优惠码 / Coupon</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value)}
                  placeholder="Coupon code"
                  style={{ flex: 1, height: 36, borderRadius: 10, padding: "0 10px", border: "1px solid rgba(148,163,184,.35)", background: "transparent" }}
                />
                <button
                  type="button"
                  disabled={busy || couponBusy}
                  onClick={() => void applyCoupon()}
                  style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.35)" }}
                >
                  {couponBusy ? "…" : "Apply"}
                </button>
              </div>
              {scene?.coupon ? (
                <div style={{ fontSize: 12, color: scene.coupon.status === "applied" ? "#047857" : "#b45309", lineHeight: 1.5 }}>
                  {scene.coupon.message}
                </div>
              ) : null}
            </div>

            {(scene?.offers ?? []).map((offer) => (
              <div
                key={offer.id}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(148,163,184,.28)",
                  padding: 14,
                  background: offer.badge ? "rgba(15,23,42,0.06)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{offer.title}</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{offer.subtitle}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, fontSize: 22 }}>
                      {formatPrice({
                        amountCents: offer.amountCents,
                        currency: offer.currency,
                        locale: scene?.locale ?? purchaseLocale,
                      })}
                    </div>
                    {offer.couponApplied && offer.originalAmountCents > offer.amountCents ? (
                      <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8", textDecoration: "line-through" }}>
                        {formatPrice({
                          amountCents: offer.originalAmountCents,
                          currency: offer.currency,
                          locale: scene?.locale ?? purchaseLocale,
                        })}
                      </div>
                    ) : null}
                    <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{offer.billingLabel}</div>
                  </div>
                </div>
                {offer.couponApplied ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#047857" }}>
                    {offer.couponLabel ?? "Coupon applied"}
                  </div>
                ) : null}
                <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: "#334155" }}>{offer.description}</div>
                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  {offer.bullets.map((bullet) => (
                    <div key={bullet} style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
                      • {bullet}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {offer.providers.map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      disabled={busy}
                      onClick={() => run(async () => {
                        const normalizedEmail = normalizeEmail(email);
                        if (!isValidEmail(normalizedEmail)) throw new Error(t("obsidian.error.invalidEmail"));
                        await kmindZenObsidianLicenseStore.ensureLoaded();
                        const devicePubKeyB64 = kmindZenObsidianLicenseStore.getDevicePubKeyB64();
                        if (!devicePubKeyB64) throw new Error(t("obsidian.error.deviceKeyMissing"));
                        const res = await apiCreatePurchaseSession({
                          sceneKey: "obsidian_plugin_default",
                          surface: "obsidian_plugin",
                          locale: purchaseLocale,
                          offerId: offer.id,
                          provider,
                          email: normalizedEmail,
                          couponCode: normalizeCouponCode(couponCode) || undefined,
                          hostContext: { devicePubKeyB64 },
                        });
                        if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
                        pollStartedAtRef.current = null;
                        pollAttemptRef.current = 0;
                        setPurchasePollState({
                          lastCheckedAtMs: null,
                          paused: false,
                        });
                        setPurchaseSession(res.result);
                        const checkoutUrl = res.result.latestAttempt?.checkoutUrl;
                        if ((provider === "stripe_checkout" || provider === "alipay_qr") && checkoutUrl) {
                          window.open(checkoutUrl, "_blank", "noopener,noreferrer");
                        }
                      })}
                      style={{ height: 34, padding: "0 12px", borderRadius: 999, border: "1px solid rgba(148,163,184,.35)" }}
                    >
                      {t(providerLabel(provider))}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {purchaseSession ? (
              <div
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(148,163,184,.28)",
                  padding: 14,
                  background: "rgba(248,250,252,0.9)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {t("obsidian.paywall.purchase.sessionTitle")} · {purchaseSession.status}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
                  {t("obsidian.paywall.purchase.sessionLabel")} {purchaseSession.id} · {t("obsidian.paywall.purchase.orderLabel")} {purchaseSession.orderId}
                </div>
                {shouldPollSession || purchasePollState.paused ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
                    {purchasePollState.paused
                      ? t("obsidian.paywall.purchase.pollingPaused")
                      : lastPurchaseCheckText
                        ? t("obsidian.paywall.purchase.pollingBackoffWithTime", { time: lastPurchaseCheckText })
                        : t("obsidian.paywall.purchase.pollingBackoff")}
                  </div>
                ) : null}
                {purchaseSession.latestAttempt?.qrCodeUrl ? (
                  <div style={{ marginTop: 12, display: "grid", justifyItems: "center", gap: 10 }}>
                    <img
                      src={purchaseSession.latestAttempt.qrCodeUrl}
                      alt="Payment QR"
                      style={{ width: 220, height: 220, borderRadius: 16, border: "1px solid rgba(148,163,184,.28)", background: "#fff", padding: 8 }}
                    />
                    {purchaseSession.latestAttempt.checkoutUrl ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!purchaseSession.latestAttempt?.checkoutUrl) return;
                          window.open(purchaseSession.latestAttempt.checkoutUrl, "_blank", "noopener,noreferrer");
                        }}
                        style={{ height: 34, padding: "0 12px", borderRadius: 999, border: "1px solid rgba(148,163,184,.35)" }}
                      >
                        {t("obsidian.paywall.purchase.openPaymentPage")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {purchaseSession.result?.backupLicenseKey ? (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#475569", whiteSpace: "pre-wrap" }}>
                    {t("obsidian.paywall.purchase.backupKey")}: <span style={{ fontFamily: "monospace" }}>{purchaseSession.result.backupLicenseKey}</span>
                  </div>
                ) : null}
                {(shouldPollSession || purchasePollState.paused) ? (
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(async () => {
                        if (!purchaseSession) return;
                        const ok = await pollPurchaseSession(purchaseSession.id);
                        if (!ok) throw new Error(t("obsidian.paywall.purchase.pollingRequestFailed"));
                        pollStartedAtRef.current = null;
                        pollAttemptRef.current = 0;
                        setPurchasePollState({
                          lastCheckedAtMs: Date.now(),
                          paused: false,
                        });
                      })}
                      style={{ height: 34, padding: "0 12px", borderRadius: 999, border: "1px solid rgba(148,163,184,.35)" }}
                    >
                      {t("obsidian.paywall.purchase.checkStatus")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ marginTop: 12, fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
          {t("obsidian.paywall.hint.offline")}
        </div>
      </div>
    </div>
  );
}
