import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totp,
  verifyTotp,
} from "../src/services/totp";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"

describe("base32", () => {
  it("bolak-balik sesuai RFC 4648", () => {
    const bytes = new TextEncoder().encode("12345678901234567890");
    expect(base32Encode(bytes)).toBe(RFC_SECRET);
    expect(new TextDecoder().decode(base32Decode(RFC_SECRET))).toBe("12345678901234567890");
  });

  it("menghasilkan secret 20 byte acak", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe("TOTP RFC 6238 (SHA-1)", () => {
  // Vektor RFC 6238 berdigit 8; TOTP kita 6 digit = 6 digit terakhir nilai yang sama.
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("waktu %i menghasilkan %s", async (seconds, expected) => {
    expect(await totp(RFC_SECRET, seconds * 1000)).toBe(expected);
  });

  it("hotp counter 0 cocok dengan vektor RFC", async () => {
    expect(await hotp(RFC_SECRET, 0)).toBe("755224");
  });
});

describe("verifyTotp", () => {
  const nowMs = 1_700_000_000_000;

  it("menerima kode saat ini dan satu langkah sebelumnya", async () => {
    const current = await totp(RFC_SECRET, nowMs);
    const previous = await totp(RFC_SECRET, nowMs - 30_000);

    expect((await verifyTotp(RFC_SECRET, current, { nowMs })).valid).toBe(true);
    expect((await verifyTotp(RFC_SECRET, previous, { nowMs })).valid).toBe(true);
  });

  it("menolak kode salah dan counter yang sudah dipakai", async () => {
    const current = await totp(RFC_SECRET, nowMs);
    const counter = Math.floor(nowMs / 1000 / 30);

    expect((await verifyTotp(RFC_SECRET, "000000", { nowMs })).valid).toBe(false);
    expect(
      (await verifyTotp(RFC_SECRET, current, { nowMs, lastCounter: counter })).valid,
    ).toBe(false);
  });
});

describe("otpauthUri", () => {
  it("membuat URI yang bisa dipindai aplikasi authenticator", () => {
    const uri = otpauthUri({ secret: RFC_SECRET, account: "admin@example.com", issuer: "Gapura" });
    expect(uri.startsWith("otpauth://totp/Gapura%3Aadmin%40example.com?")).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain("issuer=Gapura");
  });
});
