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

describe("createPaymentInputSchema accountLink", () => {
  const ovo = {
    credentialCode: "B3A72721-7FFB-EC11-812D-B4617B397E08",
    ovo: { paymentDetails: [{ paymentType: "CASH", amount: validInput.amount }] },
  };
  const shopee = {
    credentialCode: "7cXXXXX-XXXX-XXXX-9XXX-944XXXXXXX8",
    shopee: { useCoin: false },
  };

  function parseAccountLink(accountLink: unknown, paymentMethod = "OL") {
    return createPaymentInputSchema.safeParse({ ...validInput, paymentMethod, accountLink });
  }

  it("menerima OL dengan ovo dan nominal yang cocok", () => {
    expect(parseAccountLink(ovo, "OL").success).toBe(true);
  });

  it("menerima SL dengan shopee, dengan atau tanpa promoId", () => {
    expect(parseAccountLink(shopee, "SL").success).toBe(true);
    expect(
      parseAccountLink({ ...shopee, shopee: { useCoin: true, promoId: "campaign111" } }, "SL").success,
    ).toBe(true);
  });

  it("menolak accountLink pada channel selain OL/SL", () => {
    for (const paymentMethod of ["VC", "BT", "QRIS", "OV"]) {
      expect(parseAccountLink(ovo, paymentMethod).success).toBe(false);
    }
  });

  it("menolak OL/SL tanpa accountLink", () => {
    expect(
      createPaymentInputSchema.safeParse({ ...validInput, paymentMethod: "OL" }).success,
    ).toBe(false);
    expect(
      createPaymentInputSchema.safeParse({ ...validInput, paymentMethod: "SL" }).success,
    ).toBe(false);
  });

  it("menolak detail channel yang tidak sesuai", () => {
    expect(parseAccountLink(shopee, "OL").success).toBe(false);
    expect(parseAccountLink(ovo, "SL").success).toBe(false);
    expect(parseAccountLink({ ...ovo, shopee: { useCoin: false } }, "OL").success).toBe(false);
    expect(parseAccountLink({ ...shopee, ovo: ovo.ovo }, "SL").success).toBe(false);
  });

  it("menolak credentialCode kosong, terlalu panjang, atau mengandung karakter aneh", () => {
    for (const credentialCode of ["", "X".repeat(51), "ABC DEF", "ABC/DEF", "ABC\nDEF"]) {
      expect(parseAccountLink({ ...ovo, credentialCode }).success).toBe(false);
    }
  });

  it("menolak paymentDetails OVO yang nominalnya tidak sama dengan transaksi", () => {
    for (const amount of [validInput.amount - 1, validInput.amount + 1]) {
      expect(
        parseAccountLink({ ...ovo, ovo: { paymentDetails: [{ paymentType: "CASH", amount }] } })
          .success,
      ).toBe(false);
    }
  });

  it("menolak detail OVO tidak valid", () => {
    for (const paymentDetails of [
      [],
      [
        { paymentType: "CASH", amount: validInput.amount },
        { paymentType: "CASH", amount: validInput.amount },
      ],
      [{ paymentType: "CASH", amount: 0 }],
      [{ paymentType: "CASH", amount: validInput.amount + 0.5 }],
      [{ paymentType: "CASH", amount: "150000" }],
      [{ paymentType: "POINT", amount: validInput.amount }],
      [{ amount: validInput.amount }],
    ]) {
      expect(parseAccountLink({ ...ovo, ovo: { paymentDetails } }).success).toBe(false);
    }
  });

  it("menolak detail Shopee tidak valid", () => {
    for (const detail of [
      {},
      { useCoin: "false" },
      { useCoin: false, promoId: "X".repeat(51) },
    ]) {
      expect(parseAccountLink({ ...shopee, shopee: detail }, "SL").success).toBe(false);
    }
  });

  it("menolak field asing di dalam accountLink", () => {
    expect(parseAccountLink({ ...ovo, accessToken: "rahasia" }).success).toBe(false);
    expect(parseAccountLink({ ...shopee, shopee: { useCoin: false, accessToken: "x" } }, "SL").success).toBe(
      false,
    );
    expect(parseAccountLink({ ...ovo, ovo: { paymentDetails: ovo.ovo.paymentDetails, extra: 1 } }).success).toBe(
      false,
    );
  });
});
