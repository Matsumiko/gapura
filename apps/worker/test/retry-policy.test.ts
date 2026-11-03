import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, isFinalAttempt, nextAttemptDelayMs } from "../src/services/retry-policy";

describe("retry policy", () => {
  it("memakai backoff 1m, 5m, 15m, 1j, lalu 6j", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(nextAttemptDelayMs)).toEqual([
      60_000,
      300_000,
      900_000,
      3_600_000,
      21_600_000,
      21_600_000,
      21_600_000,
    ]);
  });

  it("menahan nilai aneh pada batas aman", () => {
    expect(nextAttemptDelayMs(0)).toBe(60_000);
    expect(nextAttemptDelayMs(-5)).toBe(60_000);
    expect(nextAttemptDelayMs(99)).toBe(21_600_000);
  });

  it("berhenti setelah 8 percobaan", () => {
    expect(MAX_ATTEMPTS).toBe(8);
    expect(isFinalAttempt(7)).toBe(false);
    expect(isFinalAttempt(8)).toBe(true);
  });
});
