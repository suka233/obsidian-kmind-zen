import { bytesToArrayBuffer } from "./array-buffer";

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle?.digest) {
    const digest = await subtle.digest("SHA-256", bytesToArrayBuffer(bytes));
    return bytesToHex(new Uint8Array(digest));
  }
  throw new Error("SHA-256 is unavailable; no project data was written.");
}

export async function sha256HexFromString(text: string): Promise<string> {
  const encoder = new TextEncoder();
  return sha256Hex(encoder.encode(text));
}
