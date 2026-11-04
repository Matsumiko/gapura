import type { CreateProjectInput, UpdateProjectInput } from "@gapura/shared/admin";
import type {
  AdminProject,
  AdminRepository,
  AdminSummaryRow,
  AdminTransaction,
  AdminTransactionQuery,
  AdminWebhookLog,
  AuditEntry,
  WebhookCounts,
} from "../types";

export class AdminConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminConflictError";
  }
}

export interface CreatedProject {
  project: AdminProject;
  apiKey: string;
  webhookSecret: string;
}

export interface AdminSummary {
  today: { count: number; amount: number };
  month: { count: number; amount: number };
  projects: AdminSummaryRow[];
}

export interface TransactionDetail {
  transaction: AdminTransaction;
  webhooks: AdminWebhookLog[];
}

export interface AdminService {
  summary(): Promise<AdminSummary>;
  listProjects(): Promise<AdminProject[]>;
  createProject(input: CreateProjectInput, actor: string): Promise<CreatedProject>;
  setProjectActive(id: string, active: boolean, actor: string): Promise<AdminProject | null>;
  updateProject(
    id: string,
    input: UpdateProjectInput,
    actor: string,
  ): Promise<AdminProject | null>;
  rotateApiKey(id: string, actor: string): Promise<string | null>;
  rotateWebhookSecret(id: string, actor: string): Promise<string | null>;
  listTransactions(
    query: AdminTransactionQuery,
  ): Promise<{ items: AdminTransaction[]; total: number }>;
  getTransaction(merchantOrderId: string): Promise<TransactionDetail | null>;
  listWebhooks(status: "FAILED" | "DEAD" | null, limit: number): Promise<AdminWebhookLog[]>;
  webhookCounts(): Promise<WebhookCounts>;
  retryWebhook(id: number, actor: string): Promise<boolean>;
  listAudit(limit: number): Promise<AuditEntry[]>;
}

export interface AdminServiceDeps {
  admin: AdminRepository;
  now: () => Date;
  generateApiKey: () => string;
  generateWebhookSecret: () => string;
  sha256Hex: (input: string) => Promise<string>;
}

export function createAdminService(deps: AdminServiceDeps): AdminService {
  async function audit(
    actor: string,
    action: string,
    target: string | null,
    detail: Record<string, unknown> | null,
  ): Promise<void> {
    await deps.admin.insertAudit({
      actorEmail: actor,
      action,
      target,
      detail: detail ? JSON.stringify(detail) : null,
      createdAt: deps.now().toISOString(),
    });
  }

  return {
    async summary(): Promise<AdminSummary> {
      const now = deps.now();
      const dayStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      ).toISOString();
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      ).toISOString();
      const projects = await deps.admin.summary(dayStart, monthStart);

      return {
        today: {
          count: projects.reduce((sum, row) => sum + row.todayCount, 0),
          amount: projects.reduce((sum, row) => sum + row.todayAmount, 0),
        },
        month: {
          count: projects.reduce((sum, row) => sum + row.monthCount, 0),
          amount: projects.reduce((sum, row) => sum + row.monthAmount, 0),
        },
        projects,
      };
    },

    async listProjects(): Promise<AdminProject[]> {
      return deps.admin.listProjects();
    },

    async createProject(input: CreateProjectInput, actor: string): Promise<CreatedProject> {
      const id = input.prefix.toLowerCase();
      const apiKey = deps.generateApiKey();
      const webhookSecret = deps.generateWebhookSecret();
      const createdAt = deps.now().toISOString();
      const inserted = await deps.admin.insertProject({
        id,
        name: input.name,
        prefix: input.prefix,
        apiKeyHash: await deps.sha256Hex(apiKey),
        webhookUrl: input.webhookUrl,
        webhookSecret,
        createdAt,
      });
      if (!inserted) {
        throw new AdminConflictError("Prefix atau id project sudah dipakai.");
      }

      await audit(actor, "create_project", id, { prefix: input.prefix, name: input.name });

      return {
        project: {
          id,
          name: input.name,
          prefix: input.prefix,
          webhookUrl: input.webhookUrl,
          isActive: true,
          createdAt,
        },
        apiKey,
        webhookSecret,
      };
    },

    async setProjectActive(id: string, active: boolean, actor: string): Promise<AdminProject | null> {
      const changed = await deps.admin.setProjectActive(id, active);
      if (!changed) {
        return null;
      }
      await audit(actor, active ? "activate_project" : "deactivate_project", id, null);
      return deps.admin.findProject(id);
    },

    async updateProject(
      id: string,
      input: UpdateProjectInput,
      actor: string,
    ): Promise<AdminProject | null> {
      const changed = await deps.admin.updateProjectProfile(id, input);
      if (!changed) {
        return null;
      }
      await audit(actor, "update_project", id, {
        fields: Object.keys(input),
      });
      return deps.admin.findProject(id);
    },

    async rotateApiKey(id: string, actor: string): Promise<string | null> {
      const project = await deps.admin.findProject(id);
      if (!project) {
        return null;
      }
      const apiKey = deps.generateApiKey();
      const changed = await deps.admin.updateProjectApiKeyHash(id, await deps.sha256Hex(apiKey));
      if (!changed) {
        return null;
      }
      await audit(actor, "rotate_api_key", id, null);
      return apiKey;
    },

    async rotateWebhookSecret(id: string, actor: string): Promise<string | null> {
      const project = await deps.admin.findProject(id);
      if (!project) {
        return null;
      }
      const webhookSecret = deps.generateWebhookSecret();
      const changed = await deps.admin.updateProjectWebhookSecret(id, webhookSecret);
      if (!changed) {
        return null;
      }
      await audit(actor, "rotate_webhook_secret", id, null);
      return webhookSecret;
    },

    async listTransactions(
      query: AdminTransactionQuery,
    ): Promise<{ items: AdminTransaction[]; total: number }> {
      return deps.admin.listTransactions(query);
    },

    async getTransaction(merchantOrderId: string): Promise<TransactionDetail | null> {
      const transaction = await deps.admin.findTransaction(merchantOrderId);
      if (!transaction) {
        return null;
      }
      return {
        transaction,
        webhooks: await deps.admin.listWebhookLogsFor(merchantOrderId),
      };
    },

    async listWebhooks(
      status: "FAILED" | "DEAD" | null,
      limit: number,
    ): Promise<AdminWebhookLog[]> {
      return deps.admin.listWebhookLogs(status, limit);
    },

    async webhookCounts(): Promise<WebhookCounts> {
      return deps.admin.webhookCounts();
    },

    async listAudit(limit: number): Promise<AuditEntry[]> {
      return deps.admin.listAudit(limit);
    },

    async retryWebhook(id: number, actor: string): Promise<boolean> {
      const changed = await deps.admin.requeueWebhook(id, deps.now().toISOString());
      if (changed) {
        await audit(actor, "retry_webhook", String(id), null);
      }
      return changed;
    },
  };
}

