import type { KmindZenLicenseEnvelopeV1 } from "./types";

type ApiOk<T> = { ok: true; result: T; serverTimeMs: number };
type ApiErr = { ok: false; error: { code: string; message: string } };
type ApiResponse<T> = ApiOk<T> | ApiErr;

export type ObsidianPaywallScene = {
  sceneKey: string;
  surface: "web" | "siyuan_plugin" | "obsidian_plugin";
  locale: string;
  coupon:
    | {
        status: "applied";
        code: string;
        displayName: string;
        message: string;
        affectedOfferIds: string[];
      }
    | {
        status: "invalid";
        code: string;
        message: string;
        affectedOfferIds: [];
      }
    | null;
  couponGuide: {
    text: string;
    href: string | null;
  } | null;
  eyebrow: string;
  title: string;
  subtitle: string;
  supportLine: string;
  promiseBullets: string[];
  trustBadges: string[];
  offers: Array<{
    id: string;
    skuId: string;
    kind: "perpetual" | "subscription";
    title: string;
    subtitle: string;
    description: string;
    badge: string | null;
    bullets: string[];
    providers: Array<"wechat_qr" | "alipay_qr" | "stripe_checkout">;
    ctaLabel: string;
    currency: "CNY" | "USD";
    quantity: number;
    quantityAvailable: boolean;
    quantityUnavailableReason: string | null;
    unitAmountCents: number;
    groupDiscountApplied: boolean;
    groupDiscountCents: number;
    amountCents: number;
    originalAmountCents: number;
    discountCents: number;
    couponApplied: boolean;
    couponLabel: string | null;
    compareAtCents: number | null;
    billingLabel: string;
  }>;
  faq: Array<{ question: string; answer: string }>;
  upgradeQuote?: PurchaseUpgradeQuote | null;
};

export type PurchaseUpgradeQuote = {
  currency: string;
  proofDiscountCents: number;
  finalAmountCents: number;
  proofLast4: string | null;
  ownedComponentKeys: string[];
};

export type ObsidianPurchaseSessionSnapshot = {
  id: string;
  status: "pending_payment" | "payment_processing" | "fulfilled" | "expired" | "failed" | "canceled";
  orderId: string;
  buyerEmail: string;
  originalAmountCents: number;
  discountCents: number;
  couponCode: string | null;
  quantity: number;
  latestAttempt: {
    id: string;
    provider: string;
    status: string;
    checkoutUrl: string | null;
    qrCodeUrl: string | null;
    expiresAtMs: number | null;
    paidAtMs: number | null;
  } | null;
  result:
    | {
        kind: "web";
        backupLicenseKey: string;
        licenseProduct: "siyuan_plugin" | "obsidian_plugin";
      }
    | {
        kind: "obsidian_plugin";
        backupLicenseKey: string;
        lease: KmindZenLicenseEnvelopeV1;
        refreshToken: KmindZenLicenseEnvelopeV1;
      }
    | {
        kind: "bundle";
        components: ObsidianPurchaseResultComponent[];
      }
    | {
        kind: "founders_pass";
        foundersPassCode: string;
        codeLast4: string;
        status: "issued";
      }
    | null;
  error: { code: string | null; message: string | null } | null;
};

export type ObsidianPurchaseResultComponent =
  | {
      kind: "license_key";
      componentKey: string;
      product: "siyuan_plugin" | "obsidian_plugin" | "universal";
      backupLicenseKey: string;
      autoActivated: boolean;
      lease?: KmindZenLicenseEnvelopeV1;
      refreshToken?: KmindZenLicenseEnvelopeV1;
    }
  | {
      kind: "legacy_activation_code";
      componentKey: string;
      legacyActivationCode: string;
      legacyCodeType: string;
    }
  | {
      kind: "founders_pass_code";
      componentKey: string;
      foundersPassCode: string;
      codeLast4: string;
      status: "issued";
    };

function joinUrl(base: string, path: string): string {
  const normalizedBase = String(base ?? "").trim().replace(/\/+$/, "");
  const normalizedPath = String(path ?? "").trim().replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
}

function resolveApiBase(): string {
  return String(__KMIND_ZEN_API_BASE__ ?? "").trim().replace(/\/+$/, "");
}

function resolveWebsiteBase(): string {
  return String(__KMIND_ZEN_WEBSITE_URL__ ?? "").trim().replace(/\/+$/, "") || resolveApiBase();
}

export function resolvePurchaseWebsiteUrl(locale: string): string {
  const path = String(locale ?? "").toLowerCase().replace("_", "-").startsWith("zh")
    ? "/zh/pricing"
    : "/en/pricing";
  return joinUrl(resolveWebsiteBase(), path);
}

async function requestJson<T>(args: {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs: number;
}): Promise<ApiResponse<T>> {
  const base = resolveApiBase();
  if (!base) {
    return { ok: false, error: { code: "NO_API_BASE", message: "Missing API base." } };
  }

  const url = joinUrl(base, args.path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(200, args.timeoutMs));
  try {
    const response = await fetch(url, {
      method: args.method ?? "GET",
      headers: args.method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: args.method === "POST" ? JSON.stringify(args.body ?? {}) : undefined,
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

export async function apiGetPaywallScene(args: {
  sceneKey: string;
  surface: "obsidian_plugin";
  locale: string;
}): Promise<ApiResponse<ObsidianPaywallScene>> {
  return requestJson<ObsidianPaywallScene>({
    path: `/paywall/scenes/${encodeURIComponent(args.sceneKey)}?surface=${encodeURIComponent(args.surface)}&locale=${encodeURIComponent(args.locale)}`,
    timeoutMs: 5000,
  });
}

export async function apiQuotePaywallScene(args: {
  sceneKey: string;
  surface: "obsidian_plugin";
  locale: string;
  couponCode?: string;
  buyerEmail?: string;
  offerId?: string;
  proofCode?: string;
  quantity?: number;
}): Promise<ApiResponse<ObsidianPaywallScene>> {
  return requestJson<ObsidianPaywallScene>({
    path: "/purchase/quote",
    method: "POST",
    body: args,
    timeoutMs: 6000,
  });
}

export async function apiCreatePurchaseSession(args: {
  sceneKey: string;
  surface: "obsidian_plugin";
  locale: string;
  offerId: string;
  provider: "wechat_qr" | "alipay_qr" | "stripe_checkout";
  email: string;
  couponCode?: string;
  proofCode?: string;
  refCode?: string;
  quantity?: number;
  hostContext: { devicePubKeyB64: string };
}): Promise<ApiResponse<ObsidianPurchaseSessionSnapshot>> {
  return requestJson<ObsidianPurchaseSessionSnapshot>({
    path: "/purchase/sessions",
    method: "POST",
    body: args,
    timeoutMs: 8000,
  });
}

export async function apiGetPurchaseSession(sessionId: string): Promise<ApiResponse<ObsidianPurchaseSessionSnapshot>> {
  return requestJson<ObsidianPurchaseSessionSnapshot>({
    path: `/purchase/sessions/${encodeURIComponent(sessionId)}`,
    timeoutMs: 4000,
  });
}
