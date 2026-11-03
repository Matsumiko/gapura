export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
  PANEL_ORIGIN?: string;
  DUITKU_MERCHANT_CODE?: string;
  DUITKU_API_KEY?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  prefix: string;
  webhookUrl: string;
  isActive: boolean;
}

export interface ProjectRepository {
  findByApiKeyHash(apiKeyHash: string): Promise<ProjectRecord | null>;
}

export interface AuthDeps {
  projects: ProjectRepository;
  sha256Hex: (input: string) => Promise<string>;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { project: ProjectRecord };
};
