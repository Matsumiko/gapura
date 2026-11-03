import { describe, expect, it } from "vitest";
import {
  TRANSACTION_STATUSES,
  canTransition,
  isTerminalStatus,
  type TransactionStatus,
} from "../src/status";

describe("isTerminalStatus", () => {
  it("hanya PENDING yang bukan status akhir", () => {
    expect(isTerminalStatus("PENDING")).toBe(false);
    expect(isTerminalStatus("PAID")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("EXPIRED")).toBe(true);
  });
});

describe("canTransition", () => {
  const allowed: Array<[TransactionStatus, TransactionStatus]> = [
    ["PENDING", "PENDING"],
    ["PENDING", "PAID"],
    ["PENDING", "FAILED"],
    ["PENDING", "EXPIRED"],
    ["PAID", "PAID"],
    ["FAILED", "FAILED"],
    ["EXPIRED", "EXPIRED"],
  ];

  it.each(allowed)("mengizinkan %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const rejected: Array<[TransactionStatus, TransactionStatus]> = [
    ["PAID", "FAILED"],
    ["PAID", "EXPIRED"],
    ["FAILED", "PAID"],
    ["FAILED", "EXPIRED"],
    ["EXPIRED", "PAID"],
    ["EXPIRED", "FAILED"],
  ];

  it.each(rejected)("menolak %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("menolak semua pasangan terminal yang berbeda", () => {
    for (const from of TRANSACTION_STATUSES.filter(isTerminalStatus)) {
      for (const to of TRANSACTION_STATUSES.filter(isTerminalStatus)) {
        expect(canTransition(from, to)).toBe(from === to);
      }
    }
  });
});
