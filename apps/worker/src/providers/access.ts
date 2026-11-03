import type { FetchLike } from "../providers/duitku";

export type AccessAuthCode =
  | "unconfigured"
  | "missing"
  | "invalid_format"
  | "invalid_signature"
  | "expired"
  | "wrong_audience"
  | "wrong_issuer";

export class AccessAuthError extends Error {
  constructor(
    readonly code: AccessAuthCode,
    message: string,
  ) {
    super(message);
    this.name = "AccessAuthError";
  }
}

export interface AccessIdentity {
  email: string;
  subject: string;
}

export interface AccessConfig {
  teamDomain: string;
  audience: string;
}

export interface AccessVerifier {
  verify(token: string): Promise<AccessIdentity>;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

interface TokenHeader {
  alg?: string;
  kid?: string;
}

interface TokenPayload {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  email?: unknown;
  sub?: unknown;
}

export interface AccessVerifierDeps {
  config: AccessConfig;
  fetch: FetchLike;
  now?: () => number;
  jwksTtlMs?: number;
}

const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

function normalizeDomain(teamDomain: string): string {
  const trimmed = teamDomain.replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64UrlToJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function audienceMatches(audience: unknown, expected: string): boolean {
  if (typeof audience === "string") {
    return audience === expected;
  }
  return Array.isArray(audience) && audience.includes(expected);
}

/**
 * Verifikasi JWT Cloudflare Access (RS256) memakai JWKS tim.
 * Cache kunci per isolate; kunci tak dikenal memicu fetch ulang.
 */
export function createAccessVerifier(deps: AccessVerifierDeps): AccessVerifier {
  const domain = normalizeDomain(deps.config.teamDomain);
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.jwksTtlMs ?? DEFAULT_JWKS_TTL_MS;
  let keys = new Map<string, CryptoKey>();
  let fetchedAt = 0;

  async function loadKeys(force: boolean): Promise<void> {
    if (!force && keys.size > 0 && now() - fetchedAt < ttl) {
      return;
    }
    const response = await deps.fetch(`${domain}/cdn-cgi/access/certs`);
    if (!response.ok) {
      throw new AccessAuthError("invalid_signature", "JWKS Access tidak bisa diambil.");
    }
    const body = (await response.json()) as { keys?: Jwk[] };
    const next = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid) {
        continue;
      }
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      next.set(jwk.kid, key);
    }
    if (next.size === 0) {
      throw new AccessAuthError("invalid_signature", "JWKS Access kosong.");
    }
    keys = next;
    fetchedAt = now();
  }

  return {
    async verify(token: string): Promise<AccessIdentity> {
      const parts = token.split(".");
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        throw new AccessAuthError("invalid_format", "JWT Access tidak valid.");
      }

      let header: TokenHeader;
      let payload: TokenPayload;
      try {
        header = base64UrlToJson(parts[0]) as TokenHeader;
        payload = base64UrlToJson(parts[1]) as TokenPayload;
      } catch {
        throw new AccessAuthError("invalid_format", "JWT Access tidak bisa dibaca.");
      }
      if (header.alg !== "RS256" || !header.kid) {
        throw new AccessAuthError("invalid_format", "JWT Access harus RS256 dengan kid.");
      }

      await loadKeys(false);
      let key = keys.get(header.kid);
      if (!key) {
        await loadKeys(true);
        key = keys.get(header.kid);
      }
      if (!key) {
        throw new AccessAuthError("invalid_signature", "Kunci JWT Access tidak dikenal.");
      }

      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        base64UrlToBytes(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      );
      if (!valid) {
        throw new AccessAuthError("invalid_signature", "Signature JWT Access salah.");
      }

      const current = Math.floor(now() / 1000);
      if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < current) {
        throw new AccessAuthError("expired", "JWT Access kedaluwarsa.");
      }
      if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SECONDS > current) {
        throw new AccessAuthError("expired", "JWT Access belum berlaku.");
      }
      if (payload.iss !== domain) {
        throw new AccessAuthError("wrong_issuer", "Issuer JWT Access tidak cocok.");
      }
      if (!audienceMatches(payload.aud, deps.config.audience)) {
        throw new AccessAuthError("wrong_audience", "Audience JWT Access tidak cocok.");
      }
      if (typeof payload.email !== "string" || payload.email.length === 0) {
        throw new AccessAuthError("invalid_format", "JWT Access tanpa email.");
      }

      return { email: payload.email, subject: typeof payload.sub === "string" ? payload.sub : "" };
    },
  };
}

export function extractAccessToken(headers: Headers): string | null {
  const assertion = headers.get("Cf-Access-Jwt-Assertion");
  if (assertion) {
    return assertion;
  }
  const cookie = headers.get("Cookie");
  if (!cookie) {
    return null;
  }
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "CF_Authorization") {
      return rest.join("=") || null;
    }
  }
  return null;
}
