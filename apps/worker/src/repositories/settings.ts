import type {
  MerchantCredentials,
  MerchantEnvironment,
  MerchantSettingsView,
  SettingsRepository,
} from "../types";
import type { CredentialCipher } from "../services/credentials";

interface SettingsRow {
  environment: MerchantEnvironment;
  merchant_code: string;
  api_key_ciphertext: string;
  api_key_iv: string;
  is_active: number;
  updated_at: string;
  updated_by: string;
}

export interface SettingsRepositoryDeps {
  db: D1Database;
  getCipher: () => Promise<CredentialCipher | null>;
}

function toView(row: SettingsRow): MerchantSettingsView {
  return {
    environment: row.environment,
    merchantCode: row.merchant_code,
    apiKeySet: row.api_key_ciphertext.length > 0,
    isActive: row.is_active === 1,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function createSettingsRepository(deps: SettingsRepositoryDeps): SettingsRepository {
  async function decryptRow(row: SettingsRow): Promise<MerchantCredentials> {
    const cipher = await deps.getCipher();
    if (!cipher) {
      throw new Error("CREDENTIALS_KEY belum diset.");
    }
    return {
      environment: row.environment,
      merchantCode: row.merchant_code,
      apiKey: await cipher.decrypt(row.api_key_ciphertext, row.api_key_iv),
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  return {
    async list(): Promise<MerchantSettingsView[]> {
      const rows = await deps.db
        .prepare(
          `SELECT environment, merchant_code, api_key_ciphertext, api_key_iv, is_active,
                  updated_at, updated_by
             FROM merchant_settings
            ORDER BY environment`,
        )
        .all<SettingsRow>();
      return rows.results.map(toView);
    },

    async get(environment: MerchantEnvironment): Promise<MerchantCredentials | null> {
      const row = await deps.db
        .prepare(
          `SELECT environment, merchant_code, api_key_ciphertext, api_key_iv, is_active,
                  updated_at, updated_by
             FROM merchant_settings WHERE environment = ?`,
        )
        .bind(environment)
        .first<SettingsRow>();
      return row ? decryptRow(row) : null;
    },

    async getActive(): Promise<MerchantCredentials | null> {
      const row = await deps.db
        .prepare(
          `SELECT environment, merchant_code, api_key_ciphertext, api_key_iv, is_active,
                  updated_at, updated_by
             FROM merchant_settings WHERE is_active = 1`,
        )
        .first<SettingsRow>();
      return row ? decryptRow(row) : null;
    },

    async upsert(input): Promise<boolean> {
      if (input.apiKey !== undefined) {
        const cipher = await deps.getCipher();
        if (!cipher) {
          throw new Error("CREDENTIALS_KEY belum diset.");
        }
        const encrypted = await cipher.encrypt(input.apiKey);
        const result = await deps.db
          .prepare(
            `INSERT INTO merchant_settings
               (environment, merchant_code, api_key_ciphertext, api_key_iv, is_active, updated_at, updated_by)
             VALUES (?, ?, ?, ?, 0, ?, ?)
             ON CONFLICT(environment) DO UPDATE SET
               merchant_code = excluded.merchant_code,
               api_key_ciphertext = excluded.api_key_ciphertext,
               api_key_iv = excluded.api_key_iv,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`,
          )
          .bind(
            input.environment,
            input.merchantCode,
            encrypted.ciphertext,
            encrypted.iv,
            input.updatedAt,
            input.updatedBy,
          )
          .run();
        return (result.meta.changes ?? 0) >= 1;
      }

      const result = await deps.db
        .prepare(
          `UPDATE merchant_settings
              SET merchant_code = ?, updated_at = ?, updated_by = ?
            WHERE environment = ?`,
        )
        .bind(input.merchantCode, input.updatedAt, input.updatedBy, input.environment)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async activate(environment: MerchantEnvironment): Promise<boolean> {
      const results = await deps.db.batch([
        deps.db.prepare("UPDATE merchant_settings SET is_active = 0 WHERE is_active = 1"),
        deps.db
          .prepare("UPDATE merchant_settings SET is_active = 1 WHERE environment = ?")
          .bind(environment),
      ]);
      return (results[1]?.meta.changes ?? 0) === 1;
    },
  };
}
