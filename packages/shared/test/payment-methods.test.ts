import { describe, expect, it } from "vitest";
import {
  PAYMENT_CHANNELS,
  PAYMENT_SYSTEMS,
  channelsBySystem,
  paymentChannelByCode,
} from "../src/payment-methods";

describe("katalog channel Duitku", () => {
  it("memuat seluruh 32 channel dari tabel vendor", () => {
    expect(PAYMENT_CHANNELS).toHaveLength(32);
    expect(PAYMENT_CHANNELS.map((channel) => channel.code).sort()).toEqual(
      [
        "A1","AG","AT","B1","BC","BR","BT","BV","DA","DM","DN","FT","I1","IR","JP",
        "LA","LF","M2","NC","NQ","OL","OV","S1","SA","SL","SP","SQ","T1","T2","T3","VA","VC",
      ].sort(),
    );
  });

  it("memakai kode dua karakter kapital yang unik", () => {
    const codes = PAYMENT_CHANNELS.map((channel) => channel.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{2}$/);
    }
  });

  it("setiap sistem punya channel dan setiap channel punya sistem valid", () => {
    for (const system of PAYMENT_SYSTEMS) {
      expect(channelsBySystem(system).length).toBeGreaterThan(0);
    }
    expect(PAYMENT_CHANNELS.every((channel) => PAYMENT_SYSTEMS.includes(channel.system))).toBe(true);
  });

  it("menandai void dan account link sesuai vendor", () => {
    expect(paymentChannelByCode("OV")?.supportsVoid).toBe(true);
    expect(paymentChannelByCode("SA")?.supportsVoid).toBe(true);
    expect(paymentChannelByCode("SL")?.requiresAccountLink).toBe(true);
    expect(paymentChannelByCode("OL")?.requiresAccountLink).toBe(true);
  });

  it("mencari channel berdasarkan kode dan mengembalikan undefined untuk kode asing", () => {
    expect(paymentChannelByCode("BC")?.name).toBe("BCA Virtual Account");
    expect(paymentChannelByCode("M2")?.system).toBe("Bank Transfer");
    expect(paymentChannelByCode("ZZ")).toBeUndefined();
  });
});
