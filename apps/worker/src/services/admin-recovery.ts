import { sha256Hex } from "@gapura/shared/crypto";
import type { AdminRecoveryRepository } from "../repositories/admin-recovery";

export const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_GROUPS = 4;
const RECOVERY_CODE_GROUP_SIZE = 4;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Kode acak 80 bit dalam format XXXX-XXXX-XXXX-XXXX. */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(
    new Uint8Array(RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_SIZE),
  );
  let raw = "";
  for (const byte of bytes) {
    raw += ALPHABET[byte & 31] ?? "A";
  }
  const groups: string[] = [];
  for (let index = 0; index < raw.length; index += RECOVERY_CODE_GROUP_SIZE) {
    groups.push(raw.slice(index, index + RECOVERY_CODE_GROUP_SIZE));
  }
  return groups.join("-");
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return sha256Hex(`gapura-recovery:${normalizeRecoveryCode(code)}`);
}

export interface AdminRecoveryService {
  /** Buat set kode baru; kode lama langsung tidak berlaku. Plaintext hanya dikembalikan sekali. */
  issue(adminId: string): Promise<string[]>;
  consume(adminId: string, code: string): Promise<boolean>;
  deleteAll(adminId: string): Promise<void>;
}

export function createAdminRecoveryService(deps: {
  repo: AdminRecoveryRepository;
  now: () => Date;
}): AdminRecoveryService {
  return {
    async issue(adminId: string): Promise<string[]> {
      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
      const hashes = await Promise.all(codes.map(hashRecoveryCode));
      await deps.repo.replace(adminId, hashes, deps.now().toISOString());
      return codes;
    },

    async consume(adminId: string, code: string): Promise<boolean> {
      return deps.repo.consume(adminId, await hashRecoveryCode(code), deps.now().toISOString());
    },

    async deleteAll(adminId: string): Promise<void> {
      await deps.repo.deleteAll(adminId);
    },
  };
}
