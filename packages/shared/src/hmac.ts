const encoder = new TextEncoder();

export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  let out = "";
  for (const byte of new Uint8Array(signature)) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/** Perbandingan waktu-konstan untuk signature hex. Panjang yang beda langsung ditolak. */
export function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
