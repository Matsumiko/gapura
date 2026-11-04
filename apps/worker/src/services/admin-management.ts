import { hashAdminPassword } from "./admin-password";
import type { AdminRecoveryService } from "./admin-recovery";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";
import type { CredentialCipher } from "./credentials";
import type {
  AdminManagementRepository,
  ManagedAdminRecord,
  ManagedAdminView,
} from "../repositories/admin-management";
import type { AuditEntry } from "../types";

export type AdminManagementErrorCode =
  | "not_found"
  | "conflict"
  | "invalid_totp"
  | "not_configured"
  | "self_action";

export class AdminManagementError extends Error {
  constructor(
    readonly code: AdminManagementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdminManagementError";
  }
}

export interface CreatedAdmin {
  admin: ManagedAdminView;
  /** Hanya dikembalikan sekali pada response pembuatan. */
  initialPassword: string;
  secret: string;
  otpauthUri: string;
}

export interface ActivatedAdmin {
  admin: ManagedAdminView;
  /** Hanya dikembalikan sekali; kode lama tidak berlaku. */
  recoveryCodes: string[];
}

export interface ResetAdminPassword {
  admin: ManagedAdminView;
  /** Hanya dikembalikan sekali pada response reset. */
  newPassword: string;
}

export interface ResetAdminTotp {
  admin: ManagedAdminView;
  secret: string;
  otpauthUri: string;
}

export interface AdminManagementService {
  list(): Promise<ManagedAdminView[]>;
  create(input: {
    email: string;
    role: "admin" | "viewer";
    password?: string;
    actor: string;
  }): Promise<CreatedAdmin>;
  activate(input: {
    id: string;
    totpCode: string;
    actor: string;
  }): Promise<ActivatedAdmin>;
  deactivate(input: { id: string; actor: string; actorEmail: string }): Promise<ManagedAdminView>;
  resetPassword(input: {
    id: string;
    password?: string;
    actor: string;
  }): Promise<ResetAdminPassword>;
  resetTotp(input: { id: string; actor: string }): Promise<ResetAdminTotp>;
  regenerateRecoveryCodes(input: {
    id: string;
    actor: string;
  }): Promise<{ recoveryCodes: string[] }>;
}

export interface AdminManagementDeps {
  repo: AdminManagementRepository;
  recovery: AdminRecoveryService;
  getCipher: () => Promise<CredentialCipher | null>;
  issuer: string;
  now: () => Date;
}

export function generateAdminPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toView(record: ManagedAdminRecord): ManagedAdminView {
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    isActive: record.isActive,
    totpEnabled: record.totpEnabled,
    recoveryCodesRemaining: record.recoveryCodesRemaining,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createAdminManagementService(deps: AdminManagementDeps): AdminManagementService {
  async function audit(
    actor: string,
    action: string,
    target: string,
    detail: Record<string, unknown> | null,
  ): Promise<void> {
    await deps.repo.insertAudit({
      actorEmail: actor,
      action,
      target,
      detail: detail ? JSON.stringify(detail) : null,
      createdAt: deps.now().toISOString(),
    } satisfies AuditEntry);
  }

  async function requireCipher(): Promise<CredentialCipher> {
    const cipher = await deps.getCipher();
    if (!cipher) {
      throw new AdminManagementError(
        "not_configured",
        "CREDENTIALS_KEY belum diset, TOTP tidak bisa disimpan.",
      );
    }
    return cipher;
  }

  async function requireAdmin(id: string): Promise<ManagedAdminRecord> {
    const admin = await deps.repo.findById(id);
    if (!admin) {
      throw new AdminManagementError("not_found", "Admin tidak ditemukan.");
    }
    return admin;
  }

  async function decryptSecret(admin: ManagedAdminRecord): Promise<string> {
    if (!admin.totpSecretCiphertext || !admin.totpSecretIv) {
      throw new AdminManagementError("conflict", "Admin belum punya secret TOTP.");
    }
    return (await requireCipher()).decrypt(admin.totpSecretCiphertext, admin.totpSecretIv);
  }

  return {
    async list(): Promise<ManagedAdminView[]> {
      return deps.repo.list();
    },

    async create({ email, role, password, actor }): Promise<CreatedAdmin> {
      const cipher = await requireCipher();
      const now = deps.now();
      const normalizedEmail = email.trim().toLowerCase();
      const initialPassword = password ?? generateAdminPassword();
      const secret = generateTotpSecret();
      const encrypted = await cipher.encrypt(secret);
      const created = await deps.repo.create({
        id: crypto.randomUUID(),
        email: normalizedEmail,
        passwordHash: await hashAdminPassword(initialPassword),
        role,
        totpSecretCiphertext: encrypted.ciphertext,
        totpSecretIv: encrypted.iv,
        now: now.toISOString(),
      });
      if (!created) {
        throw new AdminManagementError("conflict", "Email admin sudah dipakai.");
      }
      const admin = await deps.repo.findByEmail(normalizedEmail);
      if (!admin) {
        throw new AdminManagementError("conflict", "Admin gagal dibuat.");
      }
      await audit(actor, "create_admin", admin.id, { email: normalizedEmail, role });
      return {
        admin: toView(admin),
        initialPassword,
        secret,
        otpauthUri: otpauthUri({ secret, account: normalizedEmail, issuer: deps.issuer }),
      };
    },

    async activate({ id, totpCode, actor }): Promise<ActivatedAdmin> {
      const admin = await requireAdmin(id);
      if (admin.totpEnabled) {
        throw new AdminManagementError("conflict", "TOTP admin sudah aktif.");
      }
      if (!admin.isActive) {
        throw new AdminManagementError("conflict", "Admin nonaktif tidak bisa diaktifkan TOTP-nya.");
      }
      const secret = await decryptSecret(admin);
      const now = deps.now();
      const verification = await verifyTotp(secret, totpCode, { nowMs: now.getTime() });
      if (!verification.valid) {
        await audit(actor, "activate_admin_failed", admin.id, null);
        throw new AdminManagementError("invalid_totp", "Kode TOTP salah.");
      }
      const changed = await deps.repo.enableTotp(
        admin.id,
        verification.counter ?? 0,
        now.toISOString(),
      );
      if (!changed) {
        throw new AdminManagementError("conflict", "Gagal mengaktifkan TOTP admin.");
      }
      const recoveryCodes = await deps.recovery.issue(admin.id);
      await audit(actor, "activate_admin", admin.id, null);
      const updated = await requireAdmin(admin.id);
      return { admin: toView(updated), recoveryCodes };
    },

    async deactivate({ id, actor, actorEmail }): Promise<ManagedAdminView> {
      const admin = await requireAdmin(id);
      if (admin.email === actorEmail) {
        throw new AdminManagementError("self_action", "Tidak bisa menonaktifkan akun sendiri.");
      }
      const now = deps.now().toISOString();
      const changed = await deps.repo.setActive(admin.id, false, now);
      if (!changed) {
        throw new AdminManagementError("conflict", "Gagal menonaktifkan admin.");
      }
      await deps.repo.revokeSessionsFor(admin.id);
      await deps.recovery.deleteAll(admin.id);
      await audit(actor, "deactivate_admin", admin.id, null);
      return toView(await requireAdmin(admin.id));
    },

    async resetPassword({ id, password, actor }): Promise<ResetAdminPassword> {
      const admin = await requireAdmin(id);
      const newPassword = password ?? generateAdminPassword();
      const changed = await deps.repo.setPasswordHash(
        admin.id,
        await hashAdminPassword(newPassword),
        deps.now().toISOString(),
      );
      if (!changed) {
        throw new AdminManagementError("conflict", "Gagal reset password admin.");
      }
      await deps.repo.revokeSessionsFor(admin.id);
      await audit(actor, "reset_admin_password", admin.id, null);
      return { admin: toView(await requireAdmin(admin.id)), newPassword };
    },

    async resetTotp({ id, actor }): Promise<ResetAdminTotp> {
      const admin = await requireAdmin(id);
      const cipher = await requireCipher();
      const secret = generateTotpSecret();
      const encrypted = await cipher.encrypt(secret);
      const changed = await deps.repo.setTotpSecret(
        admin.id,
        encrypted,
        deps.now().toISOString(),
      );
      if (!changed) {
        throw new AdminManagementError("conflict", "Gagal reset TOTP admin.");
      }
      await deps.recovery.deleteAll(admin.id);
      await deps.repo.revokeSessionsFor(admin.id);
      await audit(actor, "reset_admin_totp", admin.id, null);
      return {
        admin: toView(await requireAdmin(admin.id)),
        secret,
        otpauthUri: otpauthUri({ secret, account: admin.email, issuer: deps.issuer }),
      };
    },

    async regenerateRecoveryCodes({ id, actor }): Promise<{ recoveryCodes: string[] }> {
      const admin = await requireAdmin(id);
      if (!admin.totpEnabled) {
        throw new AdminManagementError(
          "conflict",
          "Aktifkan TOTP admin sebelum membuat kode pemulihan.",
        );
      }
      const recoveryCodes = await deps.recovery.issue(admin.id);
      await audit(actor, "regenerate_recovery_codes", admin.id, null);
      return { recoveryCodes };
    },
  };
}
