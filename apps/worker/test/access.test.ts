import { describe, expect, it } from "vitest";
import {
  AccessAuthError,
  createAccessVerifier,
  extractAccessToken,
} from "../src/providers/access";

const NOW_MS = 1_780_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);
const TEAM = "https://team.example.com";
const AUD = "aud-gapura";

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encode(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function keypair(kid: string) {
  // WebCrypto mengembalikan CryptoKeyPair untuk RSA; tipe TS menyatukannya dengan CryptoKey.
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { pair, jwk: { ...exported, kid, alg: "RS256", use: "sig" } };
}

async function signToken(
  privateKey: CryptoKey,
  kid: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const header = encode({ alg: "RS256", kid, typ: "JWT" });
  const body = encode(payload);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${b64url(new Uint8Array(signature))}`;
}

function basePayload(): Record<string, unknown> {
  return {
    iss: TEAM,
    aud: AUD,
    email: "admin@example.com",
    sub: "user-1",
    exp: NOW_S + 300,
    nbf: NOW_S - 10,
  };
}

async function setup() {
  const { pair, jwk } = await keypair("kid-1");
  const fetchCalls: string[] = [];
  const verifier = createAccessVerifier({
    config: { teamDomain: TEAM, audience: AUD },
    fetch: async (input) => {
      fetchCalls.push(String(input));
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    now: () => NOW_MS,
  });
  return { verifier, privateKey: pair.privateKey, fetchCalls };
}

describe("verifikasi JWT Cloudflare Access", () => {
  it("menerima token valid dan mengembalikan identitas", async () => {
    const { verifier, privateKey } = await setup();

    const identity = await verifier.verify(await signToken(privateKey, "kid-1", basePayload()));

    expect(identity).toEqual({ email: "admin@example.com", subject: "user-1" });
  });

  it("menolak token kedaluwarsa", async () => {
    const { verifier, privateKey } = await setup();
    const token = await signToken(privateKey, "kid-1", { ...basePayload(), exp: NOW_S - 300 });

    await expect(verifier.verify(token)).rejects.toMatchObject({ code: "expired" });
  });

  it("menolak audience atau issuer yang salah", async () => {
    const { verifier, privateKey } = await setup();
    const wrongAud = await signToken(privateKey, "kid-1", { ...basePayload(), aud: "lain" });
    const wrongIss = await signToken(privateKey, "kid-1", { ...basePayload(), iss: "https://evil" });

    await expect(verifier.verify(wrongAud)).rejects.toMatchObject({ code: "wrong_audience" });
    await expect(verifier.verify(wrongIss)).rejects.toMatchObject({ code: "wrong_issuer" });
  });

  it("menolak signature yang diubah", async () => {
    const { verifier, privateKey } = await setup();
    const token = await signToken(privateKey, "kid-1", basePayload());
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -2)}AA`;

    const error = await verifier.verify(tampered).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AccessAuthError);
    expect((error as AccessAuthError).code).toBe("invalid_signature");
  });

  it("mengambil JWKS hanya sekali untuk kid yang sama", async () => {
    const { verifier, privateKey, fetchCalls } = await setup();
    const token = await signToken(privateKey, "kid-1", basePayload());

    await verifier.verify(token);
    await verifier.verify(token);

    expect(fetchCalls).toEqual([`${TEAM}/cdn-cgi/access/certs`]);
  });
});

describe("extractAccessToken", () => {
  it("memprioritaskan header Access", () => {
    const headers = new Headers({
      "Cf-Access-Jwt-Assertion": "header-token",
      Cookie: "CF_Authorization=cookie-token",
    });

    expect(extractAccessToken(headers)).toBe("header-token");
  });

  it("membaca cookie CF_Authorization bila header tidak ada", () => {
    const headers = new Headers({ Cookie: "a=1; CF_Authorization=cookie-token; b=2" });

    expect(extractAccessToken(headers)).toBe("cookie-token");
  });

  it("mengembalikan null bila tidak ada token", () => {
    expect(extractAccessToken(new Headers())).toBeNull();
  });
});
