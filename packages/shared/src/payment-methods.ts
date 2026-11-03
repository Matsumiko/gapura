export type PaymentSystem =
  | "Bank Transfer"
  | "E-Wallet"
  | "Retail"
  | "Credit Card"
  | "QRIS"
  | "PayLater"
  | "E-Banking"
  | "E-Commerce";

export interface PaymentChannel {
  /** Kode dua karakter yang dikirim sebagai `paymentMethod` ke Duitku. */
  code: string;
  name: string;
  system: PaymentSystem;
  /** Didukung void menurut tabel Duitku. */
  supportsVoid?: boolean;
  /** Butuh `accountLink.credentialCode` pada inquiry. */
  requiresAccountLink?: boolean;
  defaultExpiryMinutes?: number;
  /** null = vendor menyebut "lebih dari" nilai default, tanpa batas eksplisit. */
  maxExpiryMinutes?: number | null;
  note?: string;
}

/**
 * Katalog channel dari https://docs.duitku.com/api/id/#metode-pembayaran
 * (diakses 2026-11-03). Channel yang aktif tetap ditentukan per merchant lewat
 * getPaymentMethod; katalog ini untuk label, validasi bentuk, dan dokumentasi.
 */
export const PAYMENT_CHANNELS: readonly PaymentChannel[] = [
  { code: "VC", name: "Credit Card (Visa/Mastercard/JCB)", system: "Credit Card", defaultExpiryMinutes: 30, note: "3DS; acquirer/binWhitelist opsional" },

  { code: "BC", name: "BCA Virtual Account", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "M2", name: "Mandiri Virtual Account", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "VA", name: "Maybank Virtual Account", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "I1", name: "BNI Virtual Account", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "B1", name: "CIMB Niaga Virtual Account", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "BT", name: "Permata Bank Virtual Account", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "A1", name: "ATM Bersama", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "AG", name: "Bank Artha Graha", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "NC", name: "Bank Neo Commerce / BNC", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "BR", name: "BRIVA (BRI Virtual Account)", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "S1", name: "Bank Sahabat Sampoerna", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "DM", name: "Danamon Virtual Account", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "BV", name: "BSI Virtual Account", system: "Bank Transfer", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },

  { code: "FT", name: "Pegadaian / ALFA / Pos", system: "Retail", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },
  { code: "IR", name: "Indomaret", system: "Retail", defaultExpiryMinutes: 1440, maxExpiryMinutes: null },

  { code: "OV", name: "OVO Apps", system: "E-Wallet", supportsVoid: true, defaultExpiryMinutes: 10, maxExpiryMinutes: 1440 },
  { code: "SA", name: "ShopeePay Apps", system: "E-Wallet", supportsVoid: true, defaultExpiryMinutes: 10, maxExpiryMinutes: 60 },
  { code: "LF", name: "LinkAja Apps (Fixed Fee)", system: "E-Wallet", defaultExpiryMinutes: 24, maxExpiryMinutes: 1440, note: "biaya tetap" },
  { code: "LA", name: "LinkAja Apps (Percentage Fee)", system: "E-Wallet", defaultExpiryMinutes: 24, maxExpiryMinutes: 1440, note: "biaya persentase" },
  { code: "DA", name: "DANA", system: "E-Wallet", defaultExpiryMinutes: 1440, maxExpiryMinutes: 1440 },
  { code: "SL", name: "ShopeePay Account Link", system: "E-Wallet", requiresAccountLink: true, defaultExpiryMinutes: 30 },
  { code: "OL", name: "OVO Account Link", system: "E-Wallet", requiresAccountLink: true, defaultExpiryMinutes: 15 },

  { code: "SP", name: "ShopeePay QRIS", system: "QRIS", defaultExpiryMinutes: 10, maxExpiryMinutes: 60 },
  { code: "NQ", name: "Nobu QRIS", system: "QRIS", defaultExpiryMinutes: 24, maxExpiryMinutes: 1440 },
  { code: "SQ", name: "Nusapay QRIS", system: "QRIS", note: "expiry tidak tercantum terpisah di tabel vendor" },

  { code: "DN", name: "Indodana Paylater", system: "PayLater", defaultExpiryMinutes: 1440, maxExpiryMinutes: 1440, note: "vendor menandai sebagai Kredit*" },
  { code: "AT", name: "ATOME", system: "PayLater", defaultExpiryMinutes: 720, maxExpiryMinutes: 720, note: "vendor menandai sebagai Kredit*" },

  { code: "JP", name: "Jenius Pay", system: "E-Banking", defaultExpiryMinutes: 10, maxExpiryMinutes: 10 },

  { code: "T1", name: "Tokopedia Card Payment", system: "E-Commerce", defaultExpiryMinutes: 1440, maxExpiryMinutes: 1440 },
  { code: "T2", name: "Tokopedia E-Wallet", system: "E-Commerce", defaultExpiryMinutes: 1440, maxExpiryMinutes: 1440 },
  { code: "T3", name: "Tokopedia Others", system: "E-Commerce", defaultExpiryMinutes: 1440, maxExpiryMinutes: 1440 },
];

const BY_CODE = new Map(PAYMENT_CHANNELS.map((channel) => [channel.code, channel]));

export function paymentChannelByCode(code: string): PaymentChannel | undefined {
  return BY_CODE.get(code);
}

export const PAYMENT_SYSTEMS: readonly PaymentSystem[] = [
  "Bank Transfer",
  "E-Wallet",
  "Retail",
  "Credit Card",
  "QRIS",
  "PayLater",
  "E-Banking",
  "E-Commerce",
];

export function channelsBySystem(system: PaymentSystem): PaymentChannel[] {
  return PAYMENT_CHANNELS.filter((channel) => channel.system === system);
}
