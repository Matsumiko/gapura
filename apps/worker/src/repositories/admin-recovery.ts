export interface AdminRecoveryRepository {
  /** Ganti seluruh kode admin dengan set baru (hash), mengembalikan jumlah tersimpan. */
  replace(adminId: string, codeHashes: string[], now: string): Promise<void>;
  /** Tandai satu kode terpakai; false bila kode tidak ada atau sudah dipakai. */
  consume(adminId: string, codeHash: string, now: string): Promise<boolean>;
  deleteAll(adminId: string): Promise<void>;
}

export function createAdminRecoveryRepository(db: D1Database): AdminRecoveryRepository {
  return {
    async replace(adminId, codeHashes, now): Promise<void> {
      await db
        .prepare("DELETE FROM admin_recovery_codes WHERE admin_id = ?")
        .bind(adminId)
        .run();
      for (const codeHash of codeHashes) {
        await db
          .prepare(
            `INSERT INTO admin_recovery_codes (admin_id, code_hash, created_at)
             VALUES (?, ?, ?)
             ON CONFLICT DO NOTHING`,
          )
          .bind(adminId, codeHash, now)
          .run();
      }
    },

    async consume(adminId, codeHash, now): Promise<boolean> {
      const row = await db
        .prepare(
          "SELECT id FROM admin_recovery_codes WHERE admin_id = ? AND code_hash = ? AND used_at IS NULL",
        )
        .bind(adminId, codeHash)
        .first<{ id: number }>();
      if (!row) {
        return false;
      }
      const result = await db
        .prepare(
          "UPDATE admin_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL",
        )
        .bind(now, row.id)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async deleteAll(adminId): Promise<void> {
      await db
        .prepare("DELETE FROM admin_recovery_codes WHERE admin_id = ?")
        .bind(adminId)
        .run();
    },
  };
}
