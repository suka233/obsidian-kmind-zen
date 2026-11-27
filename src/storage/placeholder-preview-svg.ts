/**
 * What a map file shows in its preview slot (phase-25.7): fixed, without title or images, never
 * refreshed. Saves no longer render a preview into the file; an exported `.kmindz.svg` carries one.
 * The root must be a complete svg start tag with xmlns: the codec inserts the metadata after it.
 */
export const OBSIDIAN_MAP_PLACEHOLDER_SVG = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 160" width="640" height="160">`,
  `<rect x="0" y="0" width="640" height="160" fill="#ffffff"/>`,
  `<text x="32" y="70" font-size="28" font-weight="600" font-family="ui-sans-serif,system-ui,sans-serif" fill="#2d3748">KMind Zen</text>`,
  `<text x="32" y="112" font-size="16" font-family="ui-sans-serif,system-ui,sans-serif" fill="#64748b">请在 KMind Zen 中打开 · Open in KMind Zen</text>`,
  `</svg>`,
].join("");
