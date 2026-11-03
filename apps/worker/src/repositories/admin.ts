import type {
  AdminProject,
  AdminRepository,
  AdminSummaryRow,
  AdminTransaction,
  AdminTransactionQuery,
  AdminWebhookLog,
  AuditEntry,
  PaymentStatus,
} from "../types";

interface ProjectRow {
  id: string;
  name: string;
  prefix: string;
  webhook_url: string;
  is_active: number;
  created_at: string;
}

interface TransactionRow {
  merchant_order_id: string;
  project_id: string;
  project_name: string;
  project_order_id: string;
  amount: number;
  payment_method: string | null;
  status: PaymentStatus;
  payment_url: string | null;
  duitku_reference: string | null;
  created_at: string;
  updated_at: string;
}

interface WebhookRow {
  id: number;
  merchant_order_id: string;
  project_name: string;
  attempt: number;
  http_status: number | null;
  error: string | null;
  next_attempt_at: string | null;
  status: "FAILED" | "DELIVERED" | "DEAD";
  created_at: string;
}

interface SummaryQueryRow {
  project_id: string;
  project_name: string;
  today_count: number;
  today_amount: number;
  month_count: number;
  month_amount: number;
}

function toProject(row: ProjectRow): AdminProject {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    webhookUrl: row.webhook_url,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

function toTransaction(row: TransactionRow): AdminTransaction {
  return {
    merchantOrderId: row.merchant_order_id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectOrderId: row.project_order_id,
    amount: row.amount,
    paymentMethod: row.payment_method,
    status: row.status,
    paymentUrl: row.payment_url,
    reference: row.duitku_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWebhook(row: WebhookRow): AdminWebhookLog {
  return {
    id: row.id,
    merchantOrderId: row.merchant_order_id,
    projectName: row.project_name,
    attempt: row.attempt,
    httpStatus: row.http_status,
    error: row.error,
    nextAttemptAt: row.next_attempt_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

const TRANSACTION_SELECT = `SELECT t.merchant_order_id, t.project_id, p.name AS project_name,
  t.project_order_id, t.amount, t.payment_method, t.status, t.payment_url,
  t.duitku_reference, t.created_at, t.updated_at
  FROM transactions t JOIN projects p ON p.id = t.project_id`;

const WEBHOOK_SELECT = `SELECT w.id, w.merchant_order_id, p.name AS project_name, w.attempt,
  w.http_status, w.error, w.next_attempt_at, w.status, w.created_at
  FROM webhook_logs w
  JOIN transactions t ON t.merchant_order_id = w.merchant_order_id
  JOIN projects p ON p.id = t.project_id`;

export function createAdminRepository(db: D1Database): AdminRepository {
  return {
    async listProjects(): Promise<AdminProject[]> {
      const rows = await db
        .prepare(
          "SELECT id, name, prefix, webhook_url, is_active, created_at FROM projects ORDER BY name",
        )
        .all<ProjectRow>();
      return rows.results.map(toProject);
    },

    async findProject(id: string): Promise<AdminProject | null> {
      const row = await db
        .prepare(
          "SELECT id, name, prefix, webhook_url, is_active, created_at FROM projects WHERE id = ?",
        )
        .bind(id)
        .first<ProjectRow>();
      return row ? toProject(row) : null;
    },

    async insertProject(input): Promise<boolean> {
      const result = await db
        .prepare(
          `INSERT INTO projects (id, name, prefix, api_key_hash, webhook_url, webhook_secret, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          input.id,
          input.name,
          input.prefix,
          input.apiKeyHash,
          input.webhookUrl,
          input.webhookSecret,
          input.createdAt,
        )
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async setProjectActive(id: string, active: boolean): Promise<boolean> {
      const result = await db
        .prepare("UPDATE projects SET is_active = ? WHERE id = ?")
        .bind(active ? 1 : 0, id)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async updateProjectProfile(
      id: string,
      input: { name?: string; webhookUrl?: string },
    ): Promise<boolean> {
      const assignments: string[] = [];
      const params: unknown[] = [];
      if (input.name !== undefined) {
        assignments.push("name = ?");
        params.push(input.name);
      }
      if (input.webhookUrl !== undefined) {
        assignments.push("webhook_url = ?");
        params.push(input.webhookUrl);
      }
      if (assignments.length === 0) {
        return false;
      }
      params.push(id);
      const result = await db
        .prepare(`UPDATE projects SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...params)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async updateProjectApiKeyHash(id: string, hash: string): Promise<boolean> {
      const result = await db
        .prepare("UPDATE projects SET api_key_hash = ? WHERE id = ?")
        .bind(hash, id)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async updateProjectWebhookSecret(id: string, secret: string): Promise<boolean> {
      const result = await db
        .prepare("UPDATE projects SET webhook_secret = ? WHERE id = ?")
        .bind(secret, id)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async listTransactions(
      query: AdminTransactionQuery,
    ): Promise<{ items: AdminTransaction[]; total: number }> {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.projectId) {
        conditions.push("t.project_id = ?");
        params.push(query.projectId);
      }
      if (query.status) {
        conditions.push("t.status = ?");
        params.push(query.status);
      }
      if (query.from) {
        conditions.push("t.created_at >= ?");
        params.push(query.from);
      }
      if (query.to) {
        conditions.push("t.created_at <= ?");
        params.push(query.to);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const items = await db
        .prepare(`${TRANSACTION_SELECT} ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`)
        .bind(...params, query.limit, query.offset)
        .all<TransactionRow>();
      const total = await db
        .prepare(`SELECT COUNT(*) AS total FROM transactions t ${where}`)
        .bind(...params)
        .first<{ total: number }>();

      return { items: items.results.map(toTransaction), total: total?.total ?? 0 };
    },

    async findTransaction(merchantOrderId: string): Promise<AdminTransaction | null> {
      const row = await db
        .prepare(`${TRANSACTION_SELECT} WHERE t.merchant_order_id = ?`)
        .bind(merchantOrderId)
        .first<TransactionRow>();
      return row ? toTransaction(row) : null;
    },

    async listWebhookLogsFor(merchantOrderId: string): Promise<AdminWebhookLog[]> {
      const rows = await db
        .prepare(`${WEBHOOK_SELECT} WHERE w.merchant_order_id = ? ORDER BY w.id DESC`)
        .bind(merchantOrderId)
        .all<WebhookRow>();
      return rows.results.map(toWebhook);
    },

    async listWebhookLogs(
      status: "FAILED" | "DEAD" | null,
      limit: number,
    ): Promise<AdminWebhookLog[]> {
      const rows = await db
        .prepare(
          `${WEBHOOK_SELECT}
           ${status ? "WHERE w.status = ?" : ""}
           ORDER BY w.created_at DESC, w.id DESC LIMIT ?`,
        )
        .bind(...(status ? [status, limit] : [limit]))
        .all<WebhookRow>();
      return rows.results.map(toWebhook);
    },

    async requeueWebhook(id: number, nowIso: string): Promise<boolean> {
      const result = await db
        .prepare(
          `UPDATE webhook_logs
             SET status = 'FAILED', attempt = 1, next_attempt_at = ?, error = NULL
           WHERE id = ? AND status IN ('FAILED', 'DEAD')`,
        )
        .bind(nowIso, id)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async summary(dayStartIso: string, monthStartIso: string): Promise<AdminSummaryRow[]> {
      const rows = await db
        .prepare(
          `SELECT p.id AS project_id, p.name AS project_name,
                  COALESCE(SUM(CASE WHEN t.created_at >= ? THEN 1 ELSE 0 END), 0) AS today_count,
                  COALESCE(SUM(CASE WHEN t.created_at >= ? THEN t.amount ELSE 0 END), 0) AS today_amount,
                  COUNT(t.merchant_order_id) AS month_count,
                  COALESCE(SUM(t.amount), 0) AS month_amount
             FROM projects p
             LEFT JOIN transactions t
               ON t.project_id = p.id AND t.status = 'PAID' AND t.created_at >= ?
            GROUP BY p.id, p.name
            ORDER BY p.name`,
        )
        .bind(dayStartIso, dayStartIso, monthStartIso)
        .all<SummaryQueryRow>();
      return rows.results.map((row) => ({
        projectId: row.project_id,
        projectName: row.project_name,
        todayCount: row.today_count,
        todayAmount: row.today_amount,
        monthCount: row.month_count,
        monthAmount: row.month_amount,
      }));
    },

    async listAudit(limit: number): Promise<AuditEntry[]> {
      const rows = await db
        .prepare(
          `SELECT actor_email, action, target, detail, created_at
             FROM admin_audit ORDER BY id DESC LIMIT ?`,
        )
        .bind(limit)
        .all<{
          actor_email: string;
          action: string;
          target: string | null;
          detail: string | null;
          created_at: string;
        }>();
      return rows.results.map((row) => ({
        actorEmail: row.actor_email,
        action: row.action,
        target: row.target,
        detail: row.detail,
        createdAt: row.created_at,
      }));
    },

    async insertAudit(entry: AuditEntry): Promise<void> {
      await db
        .prepare(
          `INSERT INTO admin_audit (actor_email, action, target, detail, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(entry.actorEmail, entry.action, entry.target, entry.detail, entry.createdAt)
        .run();
    },
  };
}
