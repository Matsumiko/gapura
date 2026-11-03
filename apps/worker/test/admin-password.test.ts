import { describe, expect, it } from "vitest";
import { hashAdminPassword, verifyAdminPassword } from "../src/services/admin-password";

describe("password admin (Argon2id)", () => {
  it("hash berformat PHC dan bisa diverifikasi", async () => {
    const encoded = await hashAdminPassword("password-yang-panjang");

    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyAdminPassword("password-yang-panjang", encoded)).toBe(true);
    expect(await verifyAdminPassword("password-salah-panjang", encoded)).toBe(false);
  });

  it("memakai salt berbeda untuk password sama", async () => {
    const first = await hashAdminPassword("password-yang-panjang");
    const second = await hashAdminPassword("password-yang-panjang");

    expect(first).not.toBe(second);
    expect(await verifyAdminPassword("password-yang-panjang", first)).toBe(true);
    expect(await verifyAdminPassword("password-yang-panjang", second)).toBe(true);
  });

  it("menolak password pendek dan hash rusak", async () => {
    await expect(hashAdminPassword("pendek")).rejects.toThrow(/minimal 12/);
    expect(await verifyAdminPassword("apa-saja", "bukan-phc")).toBe(false);
  });
});
