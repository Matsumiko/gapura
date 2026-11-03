export const TRANSACTION_STATUSES = ["PENDING", "PAID", "FAILED", "EXPIRED"] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

const TERMINAL_STATUS: Record<TransactionStatus, boolean> = {
  PENDING: false,
  PAID: true,
  FAILED: true,
  EXPIRED: true,
};

export function isTerminalStatus(status: TransactionStatus): boolean {
  return TERMINAL_STATUS[status];
}

/**
 * Status hanya boleh maju. Pengulangan status yang sama diizinkan (idempotent),
 * status terminal tidak boleh berpindah ke terminal lain.
 */
export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  if (from === to) {
    return true;
  }
  return from === "PENDING" && isTerminalStatus(to);
}
