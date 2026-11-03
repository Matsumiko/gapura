import type {
  NewTransaction,
  PaymentStatus,
  TransactionRecord,
  TransactionRepository,
  TransactionWithProject,
} from "../types";

interface TransactionRow {
  merchant_order_id: string;
  project_id: string;
  project_order_id: string;
  amount: number;
  payment_method: string | null;
  status: PaymentStatus;
  payment_url: string | null;
  duitku_reference: string | null;
  va_number: string | null;
  qr_string: string | null;
  created_at: string;
  updated_at: string;
}

interface JoinedRow extends TransactionRow {
  webhook_url: string;
  webhook_secret: string;
  is_active: number;
}

function toRecord(row: TransactionRow): TransactionRecord {
  return {
    merchantOrderId: row.merchant_order_id,
    projectId: row.project_id,
    projectOrderId: row.project_order_id,
    amount: row.amount,
    paymentMethod: row.payment_method,
    status: row.status,
    paymentUrl: row.payment_url,
    reference: row.duitku_reference,
    vaNumber: row.va_number,
    qrString: row.qr_string,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_TRANSACTION = `SELECT merchant_order_id, project_id, project_order_id, amount, payment_method,
  status, payment_url, duitku_reference, va_number, qr_string, created_at, updated_at
  FROM transactions`;

export function createTransactionRepository(db: D1Database): TransactionRepository {
  return {
    async insertPending(input: NewTransaction): Promise<boolean> {
      const result = await db
        .prepare(
          `INSERT INTO transactions
             (merchant_order_id, project_id, project_order_id, amount, payment_method, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          input.merchantOrderId,
          input.projectId,
          input.projectOrderId,
          input.amount,
          input.paymentMethod,
          input.createdAt,
          input.createdAt,
        )
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async attachInquiry(
      merchantOrderId: string,
      reference: string,
      paymentUrl: string,
      vaNumber: string | null,
      qrString: string | null,
      updatedAt: string,
    ): Promise<void> {
      await db
        .prepare(
          `UPDATE transactions
             SET duitku_reference = ?, payment_url = ?, va_number = ?, qr_string = ?, updated_at = ?
           WHERE merchant_order_id = ? AND status = 'PENDING'`,
        )
        .bind(reference, paymentUrl, vaNumber, qrString, updatedAt, merchantOrderId)
        .run();
    },

    async setReferenceIfMissing(merchantOrderId: string, reference: string): Promise<void> {
      await db
        .prepare(
          `UPDATE transactions
             SET duitku_reference = ?
           WHERE merchant_order_id = ? AND duitku_reference IS NULL`,
        )
        .bind(reference, merchantOrderId)
        .run();
    },

    async markStatus(
      merchantOrderId: string,
      status: PaymentStatus,
      updatedAt: string,
    ): Promise<boolean> {
      const result = await db
        .prepare(
          `UPDATE transactions
             SET status = ?, updated_at = ?
           WHERE merchant_order_id = ? AND status = 'PENDING'`,
        )
        .bind(status, updatedAt, merchantOrderId)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },

    async findByProjectOrder(
      projectId: string,
      projectOrderId: string,
    ): Promise<TransactionRecord | null> {
      const row = await db
        .prepare(`${SELECT_TRANSACTION} WHERE project_id = ? AND project_order_id = ?`)
        .bind(projectId, projectOrderId)
        .first<TransactionRow>();
      return row ? toRecord(row) : null;
    },

    async findWithProject(merchantOrderId: string): Promise<TransactionWithProject | null> {
      const row = await db
        .prepare(
          `SELECT t.merchant_order_id, t.project_id, t.project_order_id, t.amount, t.payment_method,
                  t.status, t.payment_url, t.duitku_reference, t.va_number, t.qr_string,
                  t.created_at, t.updated_at,
                  p.webhook_url, p.webhook_secret, p.is_active
             FROM transactions t
             JOIN projects p ON p.id = t.project_id
            WHERE t.merchant_order_id = ?`,
        )
        .bind(merchantOrderId)
        .first<JoinedRow>();
      if (!row) {
        return null;
      }
      return {
        transaction: toRecord(row),
        project: {
          id: row.project_id,
          webhookUrl: row.webhook_url,
          webhookSecret: row.webhook_secret,
          isActive: row.is_active === 1,
        },
      };
    },

    async deletePending(merchantOrderId: string): Promise<void> {
      await db
        .prepare("DELETE FROM transactions WHERE merchant_order_id = ? AND status = 'PENDING'")
        .bind(merchantOrderId)
        .run();
    },
  };
}
