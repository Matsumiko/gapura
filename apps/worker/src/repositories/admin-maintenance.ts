/** Pembersihan tabel auth yang tidak terikat environment (D1 `DB_AUTH`). */
export interface AdminMaintenanceRepository {
  /** Hapus percobaan login lebih tua dari cutoff; mengembalikan jumlah baris. */
  deleteLoginAttemptsBefore(cutoffIso: string): Promise<number>;
}

export function createAdminMaintenanceRepository(
  db: D1Database,
): AdminMaintenanceRepository {
  return {
    async deleteLoginAttemptsBefore(cutoffIso: string): Promise<number> {
      const result = await db
        .prepare("DELETE FROM admin_login_attempts WHERE created_at < ?")
        .bind(cutoffIso)
        .run();
      return result.meta.changes ?? 0;
    },
  };
}
