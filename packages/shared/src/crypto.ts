const encoder = new TextEncoder();

const API_KEY_PREFIX = "gpk_";
const WEBHOOK_SECRET_PREFIX = "whsec_";
const SECRET_BYTES = 32;

export function hexEncode(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return hexEncode(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return hexEncode(new Uint8Array(digest));
}

/** API key project: high-entropy, ditampilkan sekali lalu hanya hash yang disimpan. */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomHex(SECRET_BYTES)}`;
}

/** Secret HMAC untuk menandatangani webhook keluar. */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomHex(SECRET_BYTES)}`;
}
