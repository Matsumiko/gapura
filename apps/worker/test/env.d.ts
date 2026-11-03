// Deklarasi minimal untuk dipakai test: node:sqlite menjalankan migrasi D1 di SQLite asli,
// dan impor `?raw` membaca file migrasi tanpa menambah @types/node ke konteks Worker.
declare module "node:sqlite" {
  export interface Statement {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
}

declare module "*?raw" {
  const content: string;
  export default content;
}
