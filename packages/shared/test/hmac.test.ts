import { describe, expect, it } from "vitest";
import { hmacSha256Hex, secureEqual } from "../src/hmac";

describe("hmacSha256Hex", () => {
  it("cocok dengan vektor uji RFC 4231 kasus 2", async () => {
    expect(await hmacSha256Hex("what do ya want for nothing?", "Jefe")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("memberi hasil berbeda untuk secret berbeda", async () => {
    expect(await hmacSha256Hex("gapura", "a")).not.toBe(await hmacSha256Hex("gapura", "b"));
  });
});

describe("secureEqual", () => {
  it("menerima string identik", () => {
    expect(secureEqual("abc123", "abc123")).toBe(true);
  });

  it("menolak string berbeda atau beda panjang", () => {
    expect(secureEqual("abc123", "abc124")).toBe(false);
    expect(secureEqual("abc", "abcd")).toBe(false);
    expect(secureEqual("", "a")).toBe(false);
  });
});
