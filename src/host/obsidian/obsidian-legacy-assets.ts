import { decodeBase64, readZipStore, type KmindzProjectSvgPayloadV3 } from "@kmind/app";

/** Obsidian cache is derived from a verified complete package. Existing bytes are never overwritten. */
export async function prepareObsidianLegacyAssets(args: {
  original: KmindzProjectSvgPayloadV3;
  normalized: KmindzProjectSvgPayloadV3;
  directory: string;
  read: (path: string) => Promise<Uint8Array | null>;
  create?: ((path: string, bytes: Uint8Array) => Promise<void>) | undefined;
}): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();
  const pack = args.normalized.assetsZipB64 ? readZipStore(decodeBase64(args.normalized.assetsZipB64), { copy: false }) : null;
  const indexBytes = pack?.get("index.json");
  const index = indexBytes ? JSON.parse(new TextDecoder().decode(indexBytes)) : null;
  for (const [id, entry] of Object.entries(args.normalized.header.assetsManifest ?? {})) {
    const expected = pack?.get(index?.assets?.[id]?.path);
    if (!expected) throw new Error("Verified legacy asset is missing from package.");
    const target = `${args.directory}/${entry.contentHash}.${entry.ext}`;
    const old = args.original.header.assetsManifest?.[id];
    const paths = new Set([target, ...(old ? [`${args.directory}/${old.contentHash}.${old.ext}`] : [])]);
    for (const path of paths) {
      const actual = await args.read(path);
      if (actual && (actual.length !== expected.length || actual.some((byte, i) => byte !== expected[i]))) {
        throw new Error(`Legacy asset cache conflicts with package; source retained: ${path}`);
      }
    }
    if (args.create && !await args.read(target)) {
      await args.create(target, expected);
      const actual = await args.read(target);
      if (!actual || actual.length !== expected.length || actual.some((byte, i) => byte !== expected[i])) {
        throw new Error(`Legacy asset publication verification failed: ${target}`);
      }
    }
    result.set(target, expected);
  }
  return result;
}
