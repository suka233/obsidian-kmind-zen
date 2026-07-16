import type { KmindThemePackageV1 } from "@kmind/app";

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string };
type ApiResponse<T> = ApiOk<T> | ApiErr;

export type PluginThemeShareSessionCreated = {
  sessionId: string;
  sessionSecret: string;
  confirmUrl: string;
  statusUrl: string;
  expiresAt: string;
  title: string;
};

export type PluginThemeShareSessionStatus = {
  sessionId: string;
  status: "waiting_for_user" | "submitted" | "failed" | "expired";
  title: string;
  expiresAt: string;
  sharedContentId: string | null;
  sharedContentVersionId: string | null;
  sharedContentStatus: string | null;
  slug: string | null;
  errorCode: string | null;
  errorMessage: string | null;
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
  if (!base) return { ok: false, error: "Missing API base." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(200, timeoutMs));
  try {
    const response = await fetch(joinUrl(base, path), {
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
    return { ok: false, error: text || `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(url: string, timeoutMs: number): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(200, timeoutMs));
  try {
    const response = await fetch(url, {
      method: "GET",
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
    return { ok: false, error: text || `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function apiCreatePluginThemeShareSession(args: {
  themePackage: KmindThemePackageV1;
  language: string;
  sharedContentId?: string | null | undefined;
}): Promise<ApiResponse<PluginThemeShareSessionCreated>> {
  return postJson<PluginThemeShareSessionCreated>("/api/shared-content/plugin-theme-share-sessions", {
    source: "obsidian_plugin",
    themePackage: args.themePackage,
    language: args.language,
    sharedContentId: args.sharedContentId ?? undefined,
  }, 8000);
}

export async function apiGetPluginThemeShareSessionStatus(statusUrl: string): Promise<ApiResponse<PluginThemeShareSessionStatus>> {
  return getJson<PluginThemeShareSessionStatus>(statusUrl, 5000);
}
