const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const DEFAULT_WINDOW = 1;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const normalized = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of normalized) {
    const index = BASE32.indexOf(char);
    if (index === -1) {
      throw new Error("base32 tidak valid");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let value = counter;
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return bytes;
}

export async function hotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, counterBytes(counter)),
  );
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const b0 = digest[offset] ?? 0;
  const b1 = digest[offset + 1] ?? 0;
  const b2 = digest[offset + 2] ?? 0;
  const b3 = digest[offset + 3] ?? 0;
  const binary = ((b0 & 0x7f) << 24) | ((b1 & 0xff) << 16) | ((b2 & 0xff) << 8) | (b3 & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export async function totp(secret: string, epochMs: number): Promise<string> {
  return hotp(secret, Math.floor(epochMs / 1000 / STEP_SECONDS));
}

export interface TotpVerifyResult {
  valid: boolean;
  counter: number | null;
}

/** Verifikasi ±window langkah; tolak counter yang sudah dipakai (replay). */
export async function verifyTotp(
  secret: string,
  code: string,
  options: { nowMs: number; lastCounter?: number | null; window?: number },
): Promise<TotpVerifyResult> {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return { valid: false, counter: null };
  }
  const current = Math.floor(options.nowMs / 1000 / STEP_SECONDS);
  const window = options.window ?? DEFAULT_WINDOW;
  for (let delta = -window; delta <= window; delta += 1) {
    const counter = current + delta;
    if (counter < 0 || (options.lastCounter != null && counter <= options.lastCounter)) {
      continue;
    }
    if ((await hotp(secret, counter)) === normalized) {
      return { valid: true, counter };
    }
  }
  return { valid: false, counter: null };
}

export function otpauthUri(input: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
