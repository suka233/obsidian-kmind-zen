import { bytesToArrayBuffer } from "./array-buffer";

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function fnv1a32(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const b of bytes) {
    hash ^= b;
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }
  return hash >>> 0;
}

function fnv1aHex(bytes: Uint8Array): string {
  return fnv1a32(bytes).toString(16).padStart(8, "0");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle?.digest) {
    const digest = await subtle.digest("SHA-256", bytesToArrayBuffer(bytes));
    return bytesToHex(new Uint8Array(digest));
  }
  return fnv1aHex(bytes);
}

export async function sha256HexFromString(text: string): Promise<string> {
  const encoder = new TextEncoder();
  return sha256Hex(encoder.encode(text));
}
