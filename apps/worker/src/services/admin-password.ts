import { argon2id } from "@noble/hashes/argon2.js";

const PARAMS = { t: 2, m: 19456, p: 1, dkLen: 32 } as const;
const VERSION = 19;
const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

/** Argon2id (OWASP minimum: 19 MiB, t=2, p=1), encoded PHC string. */
export async function hashAdminPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error("Password admin minimal 12 karakter.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = argon2id(encoder.encode(password), salt, PARAMS);
  return `$argon2id$v=${VERSION}$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyAdminPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[1] !== "argon2id" || parts[2] !== `v=${VERSION}`) {
    return false;
  }
  const params = Object.fromEntries(
    (parts[3] ?? "").split(",").map((pair) => {
      const [key, value] = pair.split("=");
      return [key ?? "", Number(value)];
    }),
  );
  if (!params.m || !params.t || !params.p) {
    return false;
  }

  const expected = fromBase64(parts[5] ?? "");
  const actual = argon2id(encoder.encode(password), fromBase64(parts[4] ?? ""), {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: expected.length,
  });
  return constantTimeEqual(actual, expected);
}
