export const ORDER_PREFIX_PATTERN = /^[A-Z]{3,6}$/;

export function isValidOrderPrefix(value: string): boolean {
  return ORDER_PREFIX_PATTERN.test(value);
}

/**
 * Order ID yang dikirim ke Duitku: `{PREFIX}-{orderId}`.
 * Prefix wajib 3-6 huruf kapital agar bisa dipetakan balik ke project dari callback.
 */
export function buildMerchantOrderId(prefix: string, projectOrderId: string): string {
  if (!isValidOrderPrefix(prefix)) {
    throw new Error(`prefix order tidak valid: "${prefix}" (wajib 3-6 huruf kapital)`);
  }
  if (projectOrderId.length === 0 || projectOrderId.trim() !== projectOrderId) {
    throw new Error("orderId project wajib tidak kosong dan tanpa spasi di awal/akhir");
  }
  return `${prefix}-${projectOrderId}`;
}

export interface ParsedMerchantOrderId {
  prefix: string;
  projectOrderId: string;
}

/**
 * Kebalikan `buildMerchantOrderId`. Dipisah pada tanda hubung pertama supaya
 * orderId project boleh mengandung tanda hubung.
 */
export function parseMerchantOrderId(merchantOrderId: string): ParsedMerchantOrderId {
  const separator = merchantOrderId.indexOf("-");
  if (separator <= 0 || separator === merchantOrderId.length - 1) {
    throw new Error(`merchant order id tidak valid: "${merchantOrderId}"`);
  }
  const prefix = merchantOrderId.slice(0, separator);
  if (!isValidOrderPrefix(prefix)) {
    throw new Error(`prefix pada merchant order id tidak valid: "${prefix}"`);
  }
  return { prefix, projectOrderId: merchantOrderId.slice(separator + 1) };
}
