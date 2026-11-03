import { describe, expect, it } from "vitest";
import { generateApiKey, generateWebhookSecret, hexEncode, sha256Hex } from "../src/crypto";

describe("hexEncode", () => {
  it("menulis tiap byte sebagai dua digit hex", () => {
    expect(hexEncode(new Uint8Array([0, 15, 16, 255]))).toBe("000f10ff");
  });
});

describe("sha256Hex", () => {
  it("cocok dengan vektor uji NIST", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("membedakan input yang berbeda", async () => {
    expect(await sha256Hex("gapura")).not.toBe(await sha256Hex("gapura "));
  });
});

describe("generateApiKey", () => {
  it("berprefix gpk_ dan berisi 32 byte acak", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^gpk_[0-9a-f]{64}$/);
  });

  it("tidak menghasilkan key yang sama", () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });
});

describe("generateWebhookSecret", () => {
  it("berprefix whsec_ dan berisi 32 byte acak", () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[0-9a-f]{64}$/);
  });
});
