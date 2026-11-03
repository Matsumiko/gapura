import type { ProjectRecord, ProjectRepository } from "../types";

interface ProjectRow {
  id: string;
  name: string;
  prefix: string;
  webhook_url: string;
  is_active: number;
}

export function createProjectsRepository(db: D1Database): ProjectRepository {
  return {
    async findByApiKeyHash(apiKeyHash: string): Promise<ProjectRecord | null> {
      const row = await db
        .prepare(
          "SELECT id, name, prefix, webhook_url, is_active FROM projects WHERE api_key_hash = ?",
        )
        .bind(apiKeyHash)
        .first<ProjectRow>();

      if (!row) {
        return null;
      }
      return {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        webhookUrl: row.webhook_url,
        isActive: row.is_active === 1,
      };
    },
  };
}
