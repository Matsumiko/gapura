import { describe, expect, it } from "vitest";
import { createPaymentInputSchema } from "../src/payment";

const validInput = {
  orderId: "INV123",
  amount: 150000,
  productDetails: "Paket Premium",
  customerName: "Budi",
  email: "budi@example.com",
  paymentMethod: "VC",
  returnUrl: "https://project-a.com/thanks",
};

describe("createPaymentInputSchema", () => {
  it("menerima nominal minimum Rp10.000", () => {
    expect(createPaymentInputSchema.safeParse({ ...validInput, amount: 10000 }).success).toBe(true);
  });

  it("menerima contoh request PRD", () => {
    expect(createPaymentInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("menolak nominal di bawah Rp10.000, pecahan, dan string", () => {
    for (const amount of [150000.5, 9999, 0, -1, "150000"]) {
      expect(createPaymentInputSchema.safeParse({ ...validInput, amount }).success).toBe(false);
    }
  });

  it("menolak email lebih dari 50 karakter", () => {
    const email = `${"a".repeat(46)}@b.co`;
    expect(createPaymentInputSchema.safeParse({ ...validInput, email }).success).toBe(false);
  });

  it("menolak email tidak valid", () => {
    for (const email of ["budi", "budi@", "@example.com", ""]) {
      expect(createPaymentInputSchema.safeParse({ ...validInput, email }).success).toBe(false);
    }
  });

  it("menolak returnUrl non-http", () => {
    for (const returnUrl of ["ftp://project-a.com/thanks", "javascript:alert(1)", "bukan-url"]) {
      expect(createPaymentInputSchema.safeParse({ ...validInput, returnUrl }).success).toBe(false);
    }
  });

  it("menolak field yang tidak dikenal", () => {
    expect(
      createPaymentInputSchema.safeParse({ ...validInput, amount: 150000, admin: true }).success,
    ).toBe(false);
  });

  it("menerima expiryPeriod dalam batas channel", () => {
    expect(createPaymentInputSchema.safeParse({ ...validInput, expiryPeriod: 60 }).success).toBe(true);
    expect(
      createPaymentInputSchema.safeParse({ ...validInput, paymentMethod: "SP", expiryPeriod: 60 }).success,
    ).toBe(true);
  });

  it("menolak expiryPeriod di luar batas atau channel maksimum", () => {
    for (const input of [
      { ...validInput, expiryPeriod: 0 },
      { ...validInput, expiryPeriod: 10081 },
      { ...validInput, paymentMethod: "SP", expiryPeriod: 120 },
    ]) {
      expect(createPaymentInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("menerima creditCardDetail hanya untuk VC", () => {
    expect(
      createPaymentInputSchema.safeParse({
        ...validInput,
        paymentMethod: "VC",
        creditCardDetail: { acquirer: "014", binWhitelist: ["014", "400000"] },
      }).success,
    ).toBe(true);

    expect(
      createPaymentInputSchema.safeParse({
        ...validInput,
        paymentMethod: "BT",
        creditCardDetail: { acquirer: "014" },
      }).success,
    ).toBe(false);
  });

  it("menolak creditCardDetail dengan acquirer atau BIN tidak valid", () => {
    for (const detail of [
      { acquirer: "999" },
      { binWhitelist: ["12"] },
      { binWhitelist: ["1234567"] },
      { binWhitelist: Array.from({ length: 26 }, () => "014") },
    ]) {
      expect(
        createPaymentInputSchema.safeParse({ ...validInput, paymentMethod: "VC", creditCardDetail: detail })
          .success,
      ).toBe(false);
    }
  });

  it("menolak orderId kosong atau berspasi di ujung", () => {
    for (const orderId of ["", " INV123", "INV123 "]) {
      expect(createPaymentInputSchema.safeParse({ ...validInput, orderId }).success).toBe(false);
    }
  });
});
