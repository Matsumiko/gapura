import { describe, expect, it } from "vitest";
import {
  adminTransactionFilterSchema,
  createProjectInputSchema,
} from "../src/admin";

describe("createProjectInputSchema", () => {
  it("menerima project valid", () => {
    const parsed = createProjectInputSchema.parse({
      name: "Project A",
      prefix: "PRJA",
      webhookUrl: "https://a.example/hook",
    });
    expect(parsed.prefix).toBe("PRJA");
  });

  it("menolak prefix pendek, huruf kecil, atau field asing", () => {
    for (const input of [
      { name: "A", prefix: "PR", webhookUrl: "https://a.example/hook" },
      { name: "A", prefix: "prja", webhookUrl: "https://a.example/hook" },
      { name: "A", prefix: "PRJA", webhookUrl: "https://a.example/hook", admin: true },
      { name: "A", prefix: "PRJA", webhookUrl: "ftp://a.example/hook" },
    ]) {
      expect(createProjectInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("adminTransactionFilterSchema", () => {
  it("memberi limit dan offset default", () => {
    expect(adminTransactionFilterSchema.parse({})).toMatchObject({ limit: 50, offset: 0 });
  });

  it("membatasi limit dan menolak status tak dikenal", () => {
    expect(adminTransactionFilterSchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(adminTransactionFilterSchema.safeParse({ status: "LAIN" }).success).toBe(false);
    expect(adminTransactionFilterSchema.safeParse({ limit: "10" }).success).toBe(true);
  });
});
