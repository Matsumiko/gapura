import { describe, expect, it } from "vitest";
import {
  buildMerchantOrderId,
  isValidOrderPrefix,
  parseMerchantOrderId,
} from "../src/order";

describe("isValidOrderPrefix", () => {
  it.each(["PRJ", "PRJA", "ABCDEF"])("menerima %s", (prefix) => {
    expect(isValidOrderPrefix(prefix)).toBe(true);
  });

  it.each(["PR", "ABCDEFG", "prja", "P R J", "PR1", ""])("menolak %s", (prefix) => {
    expect(isValidOrderPrefix(prefix)).toBe(false);
  });
});

describe("buildMerchantOrderId", () => {
  it("menggabungkan prefix dan order id project", () => {
    expect(buildMerchantOrderId("PRJA", "INV123")).toBe("PRJA-INV123");
  });

  it("menolak prefix tidak valid", () => {
    expect(() => buildMerchantOrderId("prja", "INV123")).toThrow(/prefix/);
  });

  it("menolak order id kosong atau berspasi di ujung", () => {
    expect(() => buildMerchantOrderId("PRJA", "")).toThrow(/orderId/);
    expect(() => buildMerchantOrderId("PRJA", " INV123")).toThrow(/orderId/);
    expect(() => buildMerchantOrderId("PRJA", "INV123 ")).toThrow(/orderId/);
  });
});

describe("parseMerchantOrderId", () => {
  it("mengembalikan prefix dan order id project", () => {
    expect(parseMerchantOrderId("PRJA-INV123")).toEqual({ prefix: "PRJA", projectOrderId: "INV123" });
  });

  it("hanya memisah pada tanda hubung pertama", () => {
    expect(parseMerchantOrderId("PRJA-INV-2026-001")).toEqual({
      prefix: "PRJA",
      projectOrderId: "INV-2026-001",
    });
  });

  it.each(["PRJA", "-INV123", "PRJA-", "prja-INV123", "PR-INV123"])(
    "menolak %s",
    (value) => {
      expect(() => parseMerchantOrderId(value)).toThrow();
    },
  );

  it("bolak-balik dengan buildMerchantOrderId", () => {
    const orderId = "INV-2026-001";
    expect(parseMerchantOrderId(buildMerchantOrderId("PRJA", orderId)).projectOrderId).toBe(orderId);
  });
});
