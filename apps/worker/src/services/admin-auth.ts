import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";
import { hashAdminPassword, verifyAdminPassword } from "./admin-password";
import type { CredentialCipher } from "./credentials";
import type { AdminSessionService } from "./admin-sessions";
import type { AdminUserRecord, AdminUserRepository, AuditEntry } from "../types";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

export type AdminAuthErrorCode =
  | "not_configured"
  | "setup_closed"
  | "invalid_setup_token"
  | "invalid_credentials"
  | "rate_limited";

export class AdminAuthError extends Error {
  constructor(
    readonly code: AdminAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export interface AdminAuthDeps {
  users: AdminUserRepository;
  sessions: AdminSessionService;
  getCipher: () => Promise<CredentialCipher | null>;
  setupToken: string | undefined;
  issuer: string;
  now: () => Date;
  insertAudit: (entry: AuditEntry) => Promise<void>;
  listAudit: (limit: number) => Promise<AuditEntry[]>;
}

export interface AdminIdentity {
  id: string;
  email: string;
  role: "owner" | "admin" | "viewer";
}

export interface AdminAuthService {
  status(): Promise<{ needsBootstrap: boolean; setupTokenConfigured: boolean }>;
  startBootstrap(input: { setupToken: string; email: string }): Promise<{
    secret: string;
    otpauthUri: string;
  }>;
  finishBootstrap(input: {
    setupToken: string;
    email: string;
    password: string;
    secret: string;
    totpCode: string;
  }): Promise<AdminIdentity>;
  login(input: {
    email: string;
    password: string;
    totpCode: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ token: string; csrfToken: string; expiresAt: string; admin: AdminIdentity }>;
  reauthenticate(input: { userId: string; sessionId: string; totpCode: string }): Promise<string>;
  listAudit(limit: number): Promise<AuditEntry[]>;
}

function identity(user: AdminUserRecord): AdminIdentity {
  return { id: user.id, email: user.email, role: user.role };
}

export function createAdminAuthService(deps: AdminAuthDeps): AdminAuthService {
  function assertSetup(setupToken: string): void {
    if (!deps.setupToken) {
      throw new AdminAuthError("not_configured", "ADMIN_SETUP_TOKEN belum diset.");
    }
    if (setupToken !== deps.setupToken) {
      throw new AdminAuthError("invalid_setup_token", "Setup token salah.");
    }
  }

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

  async function decryptSecret(user: AdminUserRecord): Promise<string> {
    if (!user.totpSecretCiphertext || !user.totpSecretIv) {
      throw new AdminAuthError("invalid_credentials", "TOTP belum terdaftar.");
    }
    const cipher = await deps.getCipher();
    if (!cipher) {
      throw new AdminAuthError("not_configured", "CREDENTIALS_KEY belum diset.");
    }
    return cipher.decrypt(user.totpSecretCiphertext, user.totpSecretIv);
  }

  return {
    async status() {
      return {
        needsBootstrap: (await deps.users.count()) === 0,
        setupTokenConfigured: Boolean(deps.setupToken),
      };
    },

    async startBootstrap({ setupToken, email }) {
      if ((await deps.users.count()) > 0) {
        throw new AdminAuthError("setup_closed", "Admin sudah pernah dibuat.");
      }
      assertSetup(setupToken);
      const secret = generateTotpSecret();
      return {
        secret,
        otpauthUri: otpauthUri({ secret, account: email, issuer: deps.issuer }),
      };
    },

    async finishBootstrap({ setupToken, email, password, secret, totpCode }) {
      if ((await deps.users.count()) > 0) {
        throw new AdminAuthError("setup_closed", "Admin sudah pernah dibuat.");
      }
      assertSetup(setupToken);
      const cipher = await deps.getCipher();
      if (!cipher) {
        throw new AdminAuthError("not_configured", "CREDENTIALS_KEY belum diset.");
      }

      const now = deps.now();
      const verification = await verifyTotp(secret, totpCode, { nowMs: now.getTime() });
      if (!verification.valid) {
        await audit(email, "totp_enroll", false, null);
        throw new AdminAuthError("invalid_credentials", "Kode TOTP salah.");
      }

      const encrypted = await cipher.encrypt(secret);
      const created = await deps.users.create({
        id: crypto.randomUUID(),
        email,
        passwordHash: await hashAdminPassword(password),
        role: "owner",
        totpSecretCiphertext: encrypted.ciphertext,
        totpSecretIv: encrypted.iv,
        now: now.toISOString(),
      });
      if (!created) {
        throw new AdminAuthError("setup_closed", "Gagal membuat admin.");
      }
      const user = await deps.users.findByEmail(email);
      if (!user) {
        throw new AdminAuthError("setup_closed", "Admin tidak ditemukan setelah dibuat.");
      }
      await deps.users.setTotpCounter(user.id, verification.counter ?? 0, now.toISOString());
      await audit(email, "bootstrap", true, { role: "owner" });
      return identity(user);
    },

    async login({ email, password, totpCode, ip, userAgent }) {
      const now = deps.now();
      const since = new Date(now.getTime() - WINDOW_MS).toISOString();
      if ((await deps.users.recentFailures(email, ip, since)) >= MAX_FAILURES) {
        await audit(email, "login", false, { reason: "rate_limited" });
        throw new AdminAuthError("rate_limited", "Terlalu banyak percobaan. Coba lagi nanti.");
      }

      const user = await deps.users.findByEmail(email);
      if (!user || !user.isActive || !user.totpEnabled) {
        await deps.users.recordAttempt({ email, ip, kind: "password", success: false, createdAt: now.toISOString() });
        await audit(email, "login", false, null);
        throw new AdminAuthError("invalid_credentials", "Kredensial salah.");
      }

      if (!(await verifyAdminPassword(password, user.passwordHash))) {
        await deps.users.recordAttempt({ email, ip, kind: "password", success: false, createdAt: now.toISOString() });
        await audit(email, "login", false, null);
        throw new AdminAuthError("invalid_credentials", "Kredensial salah.");
      }

      const secret = await decryptSecret(user);
      const verification = await verifyTotp(secret, totpCode, {
        nowMs: now.getTime(),
        lastCounter: user.totpLastCounter,
      });
      if (!verification.valid) {
        await deps.users.recordAttempt({ email, ip, kind: "totp", success: false, createdAt: now.toISOString() });
        await audit(email, "totp", false, null);
        throw new AdminAuthError("invalid_credentials", "Kode TOTP salah.");
      }

      await deps.users.setTotpCounter(user.id, verification.counter ?? 0, now.toISOString());
      await deps.users.recordAttempt({ email, ip, kind: "totp", success: true, createdAt: now.toISOString() });
      const issued = await deps.sessions.issue({ adminId: user.id, ip, userAgent });
      await audit(email, "login", true, null);
      return { ...issued, admin: identity(user) };
    },

    async reauthenticate({ userId, sessionId, totpCode }) {
      const now = deps.now();
      const user = await deps.users.findById(userId);
      if (!user || !user.isActive) {
        throw new AdminAuthError("invalid_credentials", "Admin tidak aktif.");
      }
      const secret = await decryptSecret(user);
      const verification = await verifyTotp(secret, totpCode, {
        nowMs: now.getTime(),
        lastCounter: user.totpLastCounter,
      });
      if (!verification.valid) {
        await audit(user.email, "reauth", false, null);
        throw new AdminAuthError("invalid_credentials", "Kode TOTP salah.");
      }
      await deps.users.setTotpCounter(user.id, verification.counter ?? 0, now.toISOString());
      const at = await deps.sessions.reauthenticate(sessionId);
      await audit(user.email, "reauth", true, null);
      return at;
    },

    async listAudit(limit) {
      return deps.listAudit(limit);
    },
  };
}
