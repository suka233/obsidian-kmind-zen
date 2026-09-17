export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000);
    let chunkBinary = "";
    for (let j = 0; j < chunk.length; j += 1) {
      chunkBinary += String.fromCharCode(chunk[j]!);
    }
    binary += chunkBinary;
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const normalized = String(base64 ?? "").trim();
  if (!normalized) return new Uint8Array();
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

