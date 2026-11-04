import { verifyAdminPassword } from "./admin-password";
import type { AdminRecoveryService } from "./admin-recovery";
import type { AdminSessionService, IssuedSession } from "./admin-sessions";
import type { AdminUserRecord, AdminUserRepository, AuditEntry } from "../types";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

export type RecoveryLoginErrorCode = "invalid_credentials" | "rate_limited";

export class RecoveryLoginError extends Error {
  constructor(
    readonly code: RecoveryLoginErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RecoveryLoginError";
  }
}

export interface RecoveryLoginIdentity {
  id: string;
  email: string;
  role: "owner" | "admin" | "viewer";
}

export interface RecoveryLoginResult extends IssuedSession {
  admin: RecoveryLoginIdentity;
}

export interface RecoveryLoginService {
  login(input: {
    email: string;
    password: string;
    recoveryCode: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<RecoveryLoginResult>;
}

export interface RecoveryLoginDeps {
  users: AdminUserRepository;
  recovery: AdminRecoveryService;
  sessions: AdminSessionService;
  now: () => Date;
  insertAudit: (entry: AuditEntry) => Promise<void>;
}

function identity(user: AdminUserRecord): RecoveryLoginIdentity {
  return { id: user.id, email: user.email, role: user.role };
}

/**
 * Login alternatif saat perangkat TOTP hilang. Faktor kedua tetap wajib:
 * password + satu kode pemulihan sekali pakai. TOTP tidak dilemahkan atau dimatikan.
 */
export function createRecoveryLoginService(deps: RecoveryLoginDeps): RecoveryLoginService {
  async function audit(
    actor: string,
    action: string,
    success: boolean,
    detail: Record<string, unknown> | null,
  ): Promise<void> {
    await deps.insertAudit({
      actorEmail: actor,
      action: `${action}:${success ? "success" : "failed"}`,
      target: null,
      detail: detail ? JSON.stringify(detail) : null,
      createdAt: deps.now().toISOString(),
    });
  }

  return {
    async login({ email, password, recoveryCode, ip, userAgent }): Promise<RecoveryLoginResult> {
      const normalizedEmail = email.toLowerCase();
      const now = deps.now();
      const since = new Date(now.getTime() - WINDOW_MS).toISOString();
      if ((await deps.users.recentFailures(normalizedEmail, ip, since)) >= MAX_FAILURES) {
        await audit(normalizedEmail, "recovery_login", false, { reason: "rate_limited" });
        throw new RecoveryLoginError("rate_limited", "Terlalu banyak percobaan. Coba lagi nanti.");
      }

      const user = await deps.users.findByEmail(normalizedEmail);
      if (!user || !user.isActive || !user.totpEnabled) {
        await deps.users.recordAttempt({
          email: normalizedEmail,
          ip,
          kind: "recovery",
          success: false,
          createdAt: now.toISOString(),
        });
        await audit(normalizedEmail, "recovery_login", false, null);
        throw new RecoveryLoginError("invalid_credentials", "Kredensial atau kode pemulihan salah.");
      }

      if (!(await verifyAdminPassword(password, user.passwordHash))) {
        await deps.users.recordAttempt({
          email: normalizedEmail,
          ip,
          kind: "recovery",
          success: false,
          createdAt: now.toISOString(),
        });
        await audit(normalizedEmail, "recovery_login", false, null);
        throw new RecoveryLoginError("invalid_credentials", "Kredensial atau kode pemulihan salah.");
      }

      const consumed = await deps.recovery.consume(user.id, recoveryCode);
      if (!consumed) {
        await deps.users.recordAttempt({
          email: normalizedEmail,
          ip,
          kind: "recovery",
          success: false,
          createdAt: now.toISOString(),
        });
        await audit(normalizedEmail, "recovery_login", false, { reason: "invalid_code" });
        throw new RecoveryLoginError("invalid_credentials", "Kredensial atau kode pemulihan salah.");
      }

      await deps.users.recordAttempt({
        email: normalizedEmail,
        ip,
        kind: "recovery",
        success: true,
        createdAt: now.toISOString(),
      });
      const issued = await deps.sessions.issue({ adminId: user.id, ip, userAgent });
      await audit(normalizedEmail, "recovery_login", true, null);
      return { ...issued, admin: identity(user) };
    },
  };
}
