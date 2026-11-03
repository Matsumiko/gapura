export const MAX_ATTEMPTS = 8;

const MAX_DELAY_MS = 21_600_000;

/** Jeda sebelum percobaan berikutnya, per percobaan yang gagal: 1m, 5m, 15m, 1j, 6j. */
export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, MAX_DELAY_MS] as const;

export function nextAttemptDelayMs(failedAttempt: number): number {
  const index = Math.min(Math.max(failedAttempt, 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[index] ?? MAX_DELAY_MS;
}

export function isFinalAttempt(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS;
}
