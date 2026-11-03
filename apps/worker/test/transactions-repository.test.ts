import { describe, expect, it } from "vitest";
import { createTransactionRepository } from "../src/repositories/transactions";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import { createTestDatabase } from "./support/d1";

const CREATED_AT = "2026-11-03T10:00:00.000Z";
const UPDATED_AT = "2026-11-03T10:05:00.000Z";

async function setup() {
  const db = createTestDatabase(`${schema1}\n${schema2}`);
  await db
    .prepare(
      `INSERT INTO projects (id, name, prefix, api_key_hash, webhook_url, webhook_secret, is_active, created_at)
       VALUES ('proja', 'Project A', 'PRJA', 'hash-a', 'https://a.example/hook', 'whsec_a', 1, ?)`,
    )
    .bind(CREATED_AT)
    .run();
  return { db, repo: createTransactionRepository(db) };
}

const NEW_TRANSACTION = {
  merchantOrderId: "PRJA-INV123",
  projectId: "proja",
  projectOrderId: "INV123",
  amount: 150000,
  paymentMethod: "VC",
  createdAt: CREATED_AT,
};

describe("transactions repository", () => {
  it("menyimpan transaksi PENDING dan menolak duplikat", async () => {
    const { repo } = await setup();

    expect(await repo.insertPending(NEW_TRANSACTION)).toBe(true);
    expect(await repo.insertPending(NEW_TRANSACTION)).toBe(false);
    expect(
      await repo.insertPending({
        ...NEW_TRANSACTION,
        merchantOrderId: "PRJA-INV123-lain",
      }),
    ).toBe(false);
  });

  it("mengisi artefak inquiry tanpa mengubah status", async () => {
    const { repo } = await setup();
    await repo.insertPending(NEW_TRANSACTION);

    await repo.attachInquiry("PRJA-INV123", "REF-1", "https://pay.example/1", "700", "QR", UPDATED_AT);

    const record = await repo.findByProjectOrder("proja", "INV123");
    expect(record).toMatchObject({
      status: "PENDING",
      reference: "REF-1",
      paymentUrl: "https://pay.example/1",
      vaNumber: "700",
      qrString: "QR",
      updatedAt: UPDATED_AT,
    });
  });

  it("hanya memajukan status dari PENDING, sekali saja", async () => {
    const { repo } = await setup();
    await repo.insertPending(NEW_TRANSACTION);

    expect(await repo.markStatus("PRJA-INV123", "PAID", UPDATED_AT)).toBe(true);
    expect(await repo.markStatus("PRJA-INV123", "PAID", UPDATED_AT)).toBe(false);
    expect(await repo.markStatus("PRJA-INV123", "FAILED", UPDATED_AT)).toBe(false);

    expect((await repo.findByProjectOrder("proja", "INV123"))?.status).toBe("PAID");
  });

  it("mengisi referensi dari callback hanya bila masih kosong", async () => {
    const { repo } = await setup();
    await repo.insertPending(NEW_TRANSACTION);

    await repo.setReferenceIfMissing("PRJA-INV123", "REF-CALLBACK");
    await repo.setReferenceIfMissing("PRJA-INV123", "REF-LAIN");

    expect((await repo.findByProjectOrder("proja", "INV123"))?.reference).toBe("REF-CALLBACK");
  });

  it("tidak menemukan transaksi milik project lain", async () => {
    const { repo } = await setup();
    await repo.insertPending(NEW_TRANSACTION);

    expect(await repo.findByProjectOrder("projb", "INV123")).toBeNull();
  });

  it("menggabungkan transaksi dengan data webhook project", async () => {
    const { repo } = await setup();
    await repo.insertPending(NEW_TRANSACTION);

    const joined = await repo.findWithProject("PRJA-INV123");

    expect(joined?.transaction.projectOrderId).toBe("INV123");
    expect(joined?.project).toEqual({
      id: "proja",
      webhookUrl: "https://a.example/hook",
      webhookSecret: "whsec_a",
      isActive: true,
    });
  });

  it("hanya menghapus transaksi yang masih PENDING", async () => {
    const { repo } = await setup();
    await repo.insertPending(NEW_TRANSACTION);
    await repo.markStatus("PRJA-INV123", "PAID", UPDATED_AT);

    await repo.deletePending("PRJA-INV123");

    expect((await repo.findByProjectOrder("proja", "INV123"))?.status).toBe("PAID");
  });
});
