import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import schemaSql from "../migrations/0001_init.sql?raw";

function openDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schemaSql);
  return db;
}

interface ProjectSeed {
  id?: string;
  prefix?: string;
  createdAt?: string;
}

function insertProject(db: DatabaseSync, seed: ProjectSeed = {}): void {
  db.prepare(
    `INSERT INTO projects (id, name, prefix, api_key_hash, webhook_url, webhook_secret, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    seed.id ?? "proja",
    "Project A",
    seed.prefix ?? "PRJA",
    "hash-a",
    "https://a.example/hook",
    "whsec-a",
    seed.createdAt ?? "2026-11-03T00:00:00.000Z",
  );
}

function insertTransaction(
  db: DatabaseSync,
  seed: { merchantOrderId?: string; projectId?: string; projectOrderId?: string } = {},
): void {
  db.prepare(
    `INSERT INTO transactions (merchant_order_id, project_id, project_order_id, amount, status, created_at, updated_at)
     VALUES (?, ?, ?, 150000, 'PENDING', ?, ?)`,
  ).run(
    seed.merchantOrderId ?? "PRJA-INV123",
    seed.projectId ?? "proja",
    seed.projectOrderId ?? "INV123",
    "2026-11-03T00:00:00.000Z",
    "2026-11-03T00:00:00.000Z",
  );
}

describe("migrasi 0001_init", () => {
  it("membuat tiga tabel inti", () => {
    const db = openDatabase();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();

    expect(rows.map((row) => row.name)).toEqual(["projects", "transactions", "webhook_logs"]);
    db.close();
  });

  it("membuat index untuk lookup API key dan retry jatuh tempo", () => {
    const db = openDatabase();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name")
      .all();

    expect(rows.map((row) => row.name)).toEqual([
      "idx_projects_api_key_hash",
      "idx_webhook_logs_due",
    ]);
    db.close();
  });

  it("menolak prefix project yang dobel", () => {
    const db = openDatabase();
    insertProject(db);
    expect(() => insertProject(db, { id: "projb" })).toThrow(/UNIQUE/);
    db.close();
  });

  it("menolak order id project yang dobel dalam satu project", () => {
    const db = openDatabase();
    insertProject(db);
    insertTransaction(db);
    expect(() => insertTransaction(db, { merchantOrderId: "PRJA-INV123-lain" })).toThrow(/UNIQUE/);
    db.close();
  });

  it("mengizinkan order id project yang sama di project berbeda", () => {
    const db = openDatabase();
    insertProject(db);
    insertProject(db, { id: "projb", prefix: "PRJB" });
    insertTransaction(db);
    expect(() =>
      insertTransaction(db, { merchantOrderId: "PRJB-INV123", projectId: "projb" }),
    ).not.toThrow();
    db.close();
  });

  it("menolak transaksi untuk project yang tidak ada", () => {
    const db = openDatabase();
    expect(() => insertTransaction(db, { projectId: "tidak-ada" })).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it("memberi default status PENDING pada log webhook", () => {
    const db = openDatabase();
    insertProject(db);
    db.prepare(
      `INSERT INTO webhook_logs (merchant_order_id, attempt, created_at)
       VALUES ('PRJA-INV123', 1, '2026-11-03T00:00:00.000Z')`,
    ).run();

    const row = db.prepare("SELECT status, next_attempt_at FROM webhook_logs").get();
    expect(row).toEqual({ status: "PENDING", next_attempt_at: null });
    db.close();
  });
});
