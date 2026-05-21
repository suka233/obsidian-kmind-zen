function escapeXmlText(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const KMINDZ_METADATA_RE = /<metadata\b[^>]*\bid=(['"])kmindz\1[^>]*>[\s\S]*?<\/metadata>/i;

export function stripKmindzMetadataFromSvgText(svgText: string): string {
  return String(svgText ?? "").replace(KMINDZ_METADATA_RE, "");
}

export function isKmindzPreviewBlank(svgText: string): boolean {
  const source = stripKmindzMetadataFromSvgText(svgText).trim();
  const svgStart = source.indexOf("<svg");
  if (svgStart < 0) return true;
  const openTagEnd = source.indexOf(">", svgStart);
  if (openTagEnd < 0) return true;
  const closeTag = source.lastIndexOf("</svg>");
  const inner = closeTag > openTagEnd ? source.slice(openTagEnd + 1, closeTag) : source.slice(openTagEnd + 1);
  return inner.trim().length === 0;
}

export function buildPlaceholderPreviewSvg(args: { title: string; subtitle?: string | null; meta?: string | null }): string {
  const safeTitle = String(args.title ?? "KMind").slice(0, 200);
  const safeSubtitle = String(args.subtitle ?? "KMind Zen").slice(0, 200);
  const meta = args.meta ? String(args.meta).slice(0, 240) : "";

  const escapedTitle = escapeXmlText(safeTitle);
  const escapedSubtitle = escapeXmlText(safeSubtitle);
  const escapedMeta = escapeXmlText(meta);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400">`,
    `<rect x="0" y="0" width="800" height="400" fill="#ffffff"/>`,
    `<text x="40" y="80" font-size="28" font-family="ui-sans-serif,system-ui" fill="#0f172a">`,
    escapedTitle,
    `</text>`,
    `<text x="40" y="120" font-size="14" font-family="ui-sans-serif,system-ui" fill="#64748b">`,
    escapedSubtitle,
    `</text>`,
    meta
      ? [
          `<text x="40" y="148" font-size="12" font-family="ui-sans-serif,system-ui" fill="#94a3b8">`,
          escapedMeta,
          `</text>`,
        ].join("")
      : "",
    `</svg>`,
  ].join("");
}

