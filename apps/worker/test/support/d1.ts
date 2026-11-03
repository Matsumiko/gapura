import { DatabaseSync } from "node:sqlite";

interface D1RunResult {
  success: boolean;
  meta: { changes: number };
  results: unknown[];
}

class TestStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): TestStatement {
    return new TestStatement(this.db, this.sql, params);
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params);
    return (row as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ success: boolean; results: T[] }> {
    return { success: true, results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }

  async run(): Promise<D1RunResult> {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
}

/**
 * D1 -> SQLite asli untuk test. Hanya method yang dipakai repository yang diimplementasikan.
 * Cast disengaja: bentuk Statement D1 jauh lebih luas daripada yang dibutuhkan di sini.
 */
export function createTestDatabase(schemaSql: string): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schemaSql);
  return {
    prepare: (sql: string) => new TestStatement(db, sql),
  } as unknown as D1Database;
}
