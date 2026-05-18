export type HistoryCheckpointTag = "auto" | "manual" | "before-restore" | "before-import" | "unknown";
export type HistoryCheckpointStorageFormat = "yjs" | "package" | "unknown";

export type ParsedHistoryCheckpointFileName = {
  ts: number | null;
  deviceId: string;
  tag: HistoryCheckpointTag;
  pinned: boolean;
  name: string | null;
  legacyLabel: string | null;
  format: "token-v1" | "kv" | "legacy" | "unknown";
  storageFormat: HistoryCheckpointStorageFormat;
};

function stripSnapshotExtension(fileName: string): { baseName: string; storageFormat: HistoryCheckpointStorageFormat } {
  const lower = String(fileName ?? "").toLowerCase();
  if (lower.endsWith(".kmindz.svg")) {
    return { baseName: fileName.slice(0, -".kmindz.svg".length), storageFormat: "package" };
  }
  if (lower.endsWith(".yjs")) {
    return { baseName: fileName.slice(0, -".yjs".length), storageFormat: "yjs" };
  }
  return { baseName: fileName, storageFormat: "unknown" };
}

function parseSnapshotFileName(fileName: string): { ts: number | null; rest: string; delimiter: "_" | "-" | null; storageFormat: HistoryCheckpointStorageFormat } {
  const { baseName, storageFormat } = stripSnapshotExtension(fileName);
  if (storageFormat === "unknown") return { ts: null, rest: fileName, delimiter: null, storageFormat };
  const underscoreIndex = baseName.indexOf("_");
  const dashIndex = baseName.indexOf("-");
  const delimiter = underscoreIndex > 0 && (dashIndex <= 0 || underscoreIndex < dashIndex) ? "_" : dashIndex > 0 ? "-" : null;
  const splitIndex = delimiter === "_" ? underscoreIndex : delimiter === "-" ? dashIndex : -1;

  const raw = splitIndex > 0 ? baseName.slice(0, splitIndex) : baseName;
  if (!/^\d+$/.test(raw)) return { ts: null, rest: fileName, delimiter: null, storageFormat };
  const ts = Number(raw);
  if (!Number.isFinite(ts) || ts <= 0) return { ts: null, rest: fileName, delimiter: null, storageFormat };
  const rest = splitIndex > 0 ? baseName.slice(splitIndex + 1) : "";
  return { ts, rest, delimiter, storageFormat };
}

function parseSnapshotKvSegments(rest: string): Record<string, string> {
  const segs = rest.split("__").slice(1);
  const out: Record<string, string> = {};
  for (const seg of segs) {
    const idx = seg.indexOf("=");
    if (idx <= 0) continue;
    const key = seg.slice(0, idx).trim();
    const value = seg.slice(idx + 1).trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function resolveTagFromFileName(fileName: string, rest: string): HistoryCheckpointTag {
  const kv = rest.includes("__") ? parseSnapshotKvSegments(rest) : null;
  const tag = kv ? String(kv.tag ?? "").trim() : "";
  if (tag === "auto") return "auto";
  if (tag === "manual") return "manual";
  if (tag === "before-restore") return "before-restore";
  if (tag === "before-import") return "before-import";

  const name = String(fileName ?? "");
  if (name.includes("before-import") || name.includes("before_import")) return "before-import";
  if (name.includes("before-restore") || name.includes("before_restore")) return "before-restore";
  if (name.includes("manual")) return "manual";
  const { ts } = parseSnapshotFileName(name);
  if (ts !== null) return "auto";
  return "unknown";
}

function parsePinnedFromRest(rest: string): boolean {
  const kv = rest.includes("__") ? parseSnapshotKvSegments(rest) : null;
  const raw = kv ? String(kv.pin ?? "").trim().toLowerCase() : "";
  return raw === "1" || raw === "true" || raw === "yes";
}

function sanitizeCheckpointNameSegment(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/[\\/:*?"<>|=]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
    .slice(0, 60);
}

function decodeCheckpointNameSegment(value: string): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const decoded = trimmed.replaceAll("_", " ").trim();
  return decoded ? decoded : null;
}

function parseNameFromRest(rest: string): string | null {
  const kv = rest.includes("__") ? parseSnapshotKvSegments(rest) : null;
  const raw = kv ? String(kv.name ?? "").trim() : "";
  return raw ? decodeCheckpointNameSegment(raw) : null;
}

function extractLegacyManualLabelFromRest(rest: string): string | null {
  const marker = "-manual-";
  const index = rest.indexOf(marker);
  if (index < 0) return null;
  const raw = rest.slice(index + marker.length).trim();
  if (!raw) return null;
  return raw.replaceAll("_", " ");
}

export function parseHistoryCheckpointFileName(fileName: string): ParsedHistoryCheckpointFileName {
  const parsed = parseSnapshotFileName(fileName);
  if (parsed.ts === null) {
    return { ts: null, deviceId: "", tag: "unknown", pinned: false, name: null, legacyLabel: null, format: "unknown", storageFormat: parsed.storageFormat };
  }

  const rest = parsed.rest;
  if (rest.includes("__")) {
    const deviceId = rest.split("__")[0] ?? "";
    const pinned = parsePinnedFromRest(rest);
    const name = parseNameFromRest(rest);
    const tag = resolveTagFromFileName(fileName, rest);
    return { ts: parsed.ts, deviceId, tag, pinned, name, legacyLabel: null, format: "kv", storageFormat: parsed.storageFormat };
  }

  if (parsed.delimiter === "_") {
    const tokens = rest.split("_").filter((token) => token.length > 0);
    const rawTag = tokens[0] ?? "";
    const tag = rawTag === "manual"
      ? "manual"
      : rawTag === "auto"
        ? "auto"
        : rawTag === "before_restore" || rawTag === "before-restore"
          ? "before-restore"
          : rawTag === "before_import" || rawTag === "before-import"
            ? "before-import"
            : resolveTagFromFileName(fileName, rest);
    const pinned = tokens.includes("pin") || tokens.includes("p1") || tokens.includes("pinned");
    const nameIndex = tokens.indexOf("name");
    const nameTokens = nameIndex >= 0 ? tokens.slice(nameIndex + 1) : [];
    const nameRaw = nameTokens.join("_");
    const name = nameRaw ? decodeCheckpointNameSegment(nameRaw) : null;
    return { ts: parsed.ts, deviceId: "", tag, pinned, name, legacyLabel: null, format: "token-v1", storageFormat: parsed.storageFormat };
  }

  const deviceId = rest.split("-")[0] ?? "";
  const tag = resolveTagFromFileName(fileName, rest);
  const legacyLabel = tag === "manual" ? extractLegacyManualLabelFromRest(rest) : null;
  return { ts: parsed.ts, deviceId, tag, pinned: false, name: null, legacyLabel, format: "legacy", storageFormat: parsed.storageFormat };
}

export function buildHistoryCheckpointFileName(args: {
  ts: number;
  tag: HistoryCheckpointTag;
  pinned: boolean;
  name: string | null;
  storageFormat?: HistoryCheckpointStorageFormat | undefined;
}): string {
  const tag = args.tag === "unknown"
    ? "auto"
    : args.tag === "before-restore"
      ? "before_restore"
      : args.tag === "before-import"
        ? "before_import"
        : args.tag;
  const tokens: string[] = [String(args.ts), tag];
  if (args.pinned) tokens.push("pin");
  const safeName = sanitizeCheckpointNameSegment(args.name ?? "");
  if (safeName) tokens.push("name", safeName);
  const ext = args.storageFormat === "package" ? ".kmindz.svg" : ".yjs";
  return `${tokens.join("_")}${ext}`;
}
