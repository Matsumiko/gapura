import type { AdminMaintenanceRepository } from "../repositories/admin-maintenance";
import type { AdminSessionService } from "./admin-sessions";

/** Retensi percobaan login: cukup untuk investigasi insiden, tidak menumpuk selamanya. */
export const LOGIN_ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface AdminMaintenanceReport {
  loginAttemptsPruned: number;
  loginAttemptsCutoff: string;
}

export interface AdminMaintenance {
  run(): Promise<AdminMaintenanceReport>;
}

/**
 * Pembersihan berkala untuk data auth di `DB_AUTH` bersama:
 * sesi kedaluwarsa dan percobaan login lama. Idempoten, aman dijalankan tiap Cron.
 */
export function createAdminMaintenance(deps: {
  sessions: Pick<AdminSessionService, "cleanup">;
  attempts: AdminMaintenanceRepository;
  now: () => Date;
  retentionMs?: number;
}): AdminMaintenance {
  const retentionMs = deps.retentionMs ?? LOGIN_ATTEMPT_RETENTION_MS;

  return {
    async run(): Promise<AdminMaintenanceReport> {
      await deps.sessions.cleanup();
      const cutoff = new Date(deps.now().getTime() - retentionMs).toISOString();
      return {
        loginAttemptsPruned: await deps.attempts.deleteLoginAttemptsBefore(cutoff),
        loginAttemptsCutoff: cutoff,
      };
    },
  };
}
