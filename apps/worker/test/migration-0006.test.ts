import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import schema1 from "../migrations/0001_init.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import schema6 from "../migrations/0006_admin_ops.sql?raw";

function openDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`${schema1}\n${schema3}\n${schema5}\n${schema6}`);
  db.prepare(
    `INSERT INTO projects (id, name, prefix, api_key_hash, webhook_url, webhook_secret, is_active, created_at)
     VALUES ('proja', 'Project A', 'PRJA', 'hash-a', 'https://a.example/hook', 'whsec-a', 1, ?)`,
  ).run("2026-11-04T00:00:00.000Z");
  db.prepare(
    `INSERT INTO admin_users
       (id, email, password_hash, role, totp_enabled, is_active, created_at, updated_at)
     VALUES ('admin-1', 'admin@example.com', 'hash', 'owner', 1, 1, ?, ?)`,
  ).run("2026-11-04T00:00:00.000Z", "2026-11-04T00:00:00.000Z");
  return db;
}

describe("migrasi 0006_admin_ops", () => {
  it("membuat tabel kode pemulihan dan rate limit", () => {
    const db = openDatabase();
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();

    expect(rows.map((row) => row.name)).toContain("admin_recovery_codes");
    expect(rows.map((row) => row.name)).toContain("project_rate_limits");
    db.close();
  });

  it("menolak hash kode pemulihan yang sama untuk admin yang sama", () => {
    const db = openDatabase();
    db.prepare(
      "INSERT INTO admin_recovery_codes (admin_id, code_hash, created_at) VALUES (?, ?, ?)",
    ).run("admin-1", "hash-code", "2026-11-04T00:00:00.000Z");

    expect(() =>
      db
        .prepare(
          "INSERT INTO admin_recovery_codes (admin_id, code_hash, created_at) VALUES (?, ?, ?)",
        )
        .run("admin-1", "hash-code", "2026-11-04T00:00:00.000Z"),
    ).toThrow(/UNIQUE/);
    db.close();
  });

  it("menjaga satu baris per project dan window", () => {
    const db = openDatabase();
    db.prepare(
      "INSERT INTO project_rate_limits (project_id, window_start, count) VALUES (?, ?, ?)",
    ).run("proja", 100, 1);

    expect(() =>
      db
        .prepare("INSERT INTO project_rate_limits (project_id, window_start, count) VALUES (?, ?, ?)")
        .run("proja", 100, 2),
    ).toThrow(/UNIQUE/);

    expect(() =>
      db
        .prepare("INSERT INTO project_rate_limits (project_id, window_start, count) VALUES (?, ?, ?)")
        .run("tidak-ada", 100, 1),
    ).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it("menghapus kode pemulihan saat admin dihapus", () => {
    const db = openDatabase();
    db.prepare(
      "INSERT INTO admin_recovery_codes (admin_id, code_hash, created_at) VALUES (?, ?, ?)",
    ).run("admin-1", "hash-code", "2026-11-04T00:00:00.000Z");

    db.prepare("DELETE FROM admin_users WHERE id = ?").run("admin-1");
    const row = db
      .prepare("SELECT COUNT(*) AS total FROM admin_recovery_codes")
      .get() as { total: number };
    expect(row.total).toBe(0);
    db.close();
  });
});
