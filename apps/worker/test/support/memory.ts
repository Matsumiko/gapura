import type {
  NewTransaction,
  PaymentStatus,
  ProjectWebhookTarget,
  TransactionRecord,
  TransactionRepository,
  TransactionWithProject,
} from "../../src/types";

export interface MemoryTransactions {
  repo: TransactionRepository;
  rows: Map<string, TransactionRecord>;
}

export function createMemoryTransactionRepository(
  projects: Record<string, ProjectWebhookTarget>,
): MemoryTransactions {
  const rows = new Map<string, TransactionRecord>();

  const repo: TransactionRepository = {
    async insertPending(input: NewTransaction): Promise<boolean> {
      for (const row of rows.values()) {
        if (row.projectId === input.projectId && row.projectOrderId === input.projectOrderId) {
          return false;
        }
      }
      if (rows.has(input.merchantOrderId)) {
        return false;
      }
      rows.set(input.merchantOrderId, {
        merchantOrderId: input.merchantOrderId,
        projectId: input.projectId,
        projectOrderId: input.projectOrderId,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        status: "PENDING",
        paymentUrl: null,
        reference: null,
        vaNumber: null,
        qrString: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      });
      return true;
    },

    async attachInquiry(merchantOrderId, reference, paymentUrl, vaNumber, qrString, updatedAt) {
      const row = rows.get(merchantOrderId);
      if (!row || row.status !== "PENDING") {
        return;
      }
      rows.set(merchantOrderId, { ...row, reference, paymentUrl, vaNumber, qrString, updatedAt });
    },

    async setReferenceIfMissing(merchantOrderId, reference): Promise<void> {
      const row = rows.get(merchantOrderId);
      if (!row || row.reference !== null) {
        return;
      }
      rows.set(merchantOrderId, { ...row, reference });
    },

    async markStatus(merchantOrderId, status: PaymentStatus, updatedAt): Promise<boolean> {
      const row = rows.get(merchantOrderId);
      if (!row || row.status !== "PENDING") {
        return false;
      }
      rows.set(merchantOrderId, { ...row, status, updatedAt });
      return true;
    },

    async findByProjectOrder(projectId, projectOrderId): Promise<TransactionRecord | null> {
      for (const row of rows.values()) {
        if (row.projectId === projectId && row.projectOrderId === projectOrderId) {
          return { ...row };
        }
      }
      return null;
    },

    async findWithProject(merchantOrderId): Promise<TransactionWithProject | null> {
      const row = rows.get(merchantOrderId);
      if (!row) {
        return null;
      }
      const project = projects[row.projectId];
      if (!project) {
        throw new Error(`project ${row.projectId} tidak ada di fixture`);
      }
      return { transaction: { ...row }, project };
    },

    async findPendingWithProjectBefore(cutoffIso, limit): Promise<TransactionWithProject[]> {
      return [...rows.values()]
        .filter((row) => row.status === "PENDING" && row.createdAt <= cutoffIso)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit)
        .map((row) => {
          const project = projects[row.projectId];
          if (!project) {
            throw new Error(`project ${row.projectId} tidak ada di fixture`);
          }
          return { transaction: { ...row }, project };
        });
    },

    async deletePending(merchantOrderId): Promise<void> {
      if (rows.get(merchantOrderId)?.status === "PENDING") {
        rows.delete(merchantOrderId);
      }
    },
  };

  return { repo, rows };
}
