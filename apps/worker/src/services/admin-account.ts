import { hashAdminPassword, verifyAdminPassword } from "./admin-password";
import type { AdminRecoveryService } from "./admin-recovery";
import type { AdminAccountRepository } from "../repositories/admin-account";
import type { AdminUserRecord, AdminUserRepository, AuditEntry } from "../types";

export type AdminAccountErrorCode =
  | "invalid_credentials"
  | "conflict"
  | "not_configured"
  | "not_found";

export class AdminAccountError extends Error {
  constructor(
    readonly code: AdminAccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdminAccountError";
  }
}

export interface AdminAccountView {
  id: string;
  email: string;
  role: "owner" | "admin" | "viewer";
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
}

export interface AdminAccountService {
  overview(adminId: string): Promise<AdminAccountView>;
  changeEmail(input: {
    adminId: string;
    sessionId: string;
    email: string;
    password: string;
  }): Promise<AdminAccountView & { revokedSessions: number }>;
  changePassword(input: {
    adminId: string;
    sessionId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ revokedSessions: number }>;
  regenerateRecoveryCodes(input: {
    adminId: string;
    password: string;
  }): Promise<{ codes: string[] }>;
}

export interface AdminAccountDeps {
  users: AdminUserRepository;
  repo: AdminAccountRepository;
  recovery: AdminRecoveryService;
  now: () => Date;
}

export function createAdminAccountService(deps: AdminAccountDeps): AdminAccountService {
  async function audit(
    actor: string,
    action: string,
    success: boolean,
    detail: Record<string, unknown> | null,
  ): Promise<void> {
    await deps.repo.insertAudit({
      actorEmail: actor,
      action: `${action}:${success ? "success" : "failed"}`,
      target: null,
      detail: detail ? JSON.stringify(detail) : null,
      createdAt: deps.now().toISOString(),
    } satisfies AuditEntry);
  }

  async function requireUser(adminId: string): Promise<AdminUserRecord> {
    const user = await deps.users.findById(adminId);
    if (!user) {
      throw new AdminAccountError("not_found", "Admin tidak ditemukan.");
    }
    return user;
  }

  async function verifyPassword(
    user: AdminUserRecord,
    password: string,
    action: string,
  ): Promise<void> {
    if (!user.isActive || !user.totpEnabled) {
      await audit(user.email, action, false, { reason: "inactive" });
      throw new AdminAccountError("invalid_credentials", "Admin tidak aktif atau TOTP belum aktif.");
    }
    if (!(await verifyAdminPassword(password, user.passwordHash))) {
      await audit(user.email, action, false, { reason: "password" });
      throw new AdminAccountError("invalid_credentials", "Password saat ini salah.");
    }
  }

  async function view(user: AdminUserRecord): Promise<AdminAccountView> {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      totpEnabled: user.totpEnabled,
      recoveryCodesRemaining: await deps.repo.countRecoveryCodes(user.id),
    };
  }

  return {
    async overview(adminId) {
      return view(await requireUser(adminId));
    },

    async changeEmail({ adminId, sessionId, email, password }) {
      const user = await requireUser(adminId);
      await verifyPassword(user, password, "account.email");
      const nextEmail = email.trim().toLowerCase();
      if (nextEmail === user.email.toLowerCase()) {
        return { ...(await view(user)), revokedSessions: 0 };
      }
      const existing = await deps.users.findByEmail(nextEmail);
      if (existing && existing.id !== user.id) {
        await audit(user.email, "account.email", false, { reason: "conflict", nextEmail });
        throw new AdminAccountError("conflict", "Email sudah dipakai admin lain.");
      }
      try {
        await deps.users.updateEmail(user.id, nextEmail, deps.now().toISOString());
      } catch (error) {
        const conflicting = await deps.users.findByEmail(nextEmail);
        if (conflicting && conflicting.id !== user.id) {
          await audit(user.email, "account.email", false, { reason: "conflict", nextEmail });
          throw new AdminAccountError("conflict", "Email sudah dipakai admin lain.");
        }
        throw error;
      }
      const revokedSessions = await deps.repo.revokeOtherSessions(user.id, sessionId);
      await audit(nextEmail, "account.email", true, { from: user.email, to: nextEmail });
      const updated = await requireUser(user.id);
      return { ...(await view(updated)), revokedSessions };
    },

    async changePassword({ adminId, sessionId, currentPassword, newPassword }) {
      const user = await requireUser(adminId);
      await verifyPassword(user, currentPassword, "account.password");
      const hash = await hashAdminPassword(newPassword);
      await deps.users.updatePasswordHash(user.id, hash, deps.now().toISOString());
      const revokedSessions = await deps.repo.revokeOtherSessions(user.id, sessionId);
      await audit(user.email, "account.password", true, { revokedSessions });
      return { revokedSessions };
    },

    async regenerateRecoveryCodes({ adminId, password }) {
      const user = await requireUser(adminId);
      await verifyPassword(user, password, "account.recovery_codes");
      const codes = await deps.recovery.issue(user.id);
      await audit(user.email, "account.recovery_codes", true, { count: codes.length });
      return { codes };
    },
  };
}
