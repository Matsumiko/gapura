export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
  PANEL_ORIGIN?: string;
  PUBLIC_BASE_URL?: string;
  DUITKU_BASE_URL?: string;
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

export interface ProjectWebhookTarget {
  id: string;
  webhookUrl: string;
  webhookSecret: string;
  isActive: boolean;
}

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED";

export interface TransactionRecord {
  merchantOrderId: string;
  projectId: string;
  projectOrderId: string;
  amount: number;
  paymentMethod: string | null;
  status: PaymentStatus;
  paymentUrl: string | null;
  reference: string | null;
  vaNumber: string | null;
  qrString: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionWithProject {
  transaction: TransactionRecord;
  project: ProjectWebhookTarget;
}

export interface NewTransaction {
  merchantOrderId: string;
  projectId: string;
  projectOrderId: string;
  amount: number;
  paymentMethod: string;
  createdAt: string;
}

export interface TransactionRepository {
  /** false bila pasangan (project, order) atau merchant order id sudah ada. */
  insertPending(input: NewTransaction): Promise<boolean>;
  attachInquiry(
    merchantOrderId: string,
    reference: string,
    paymentUrl: string,
    vaNumber: string | null,
    qrString: string | null,
    updatedAt: string,
  ): Promise<void>;
  /** Isi referensi Duitku dari callback bila inquiry belum menyimpannya. */
  setReferenceIfMissing(merchantOrderId: string, reference: string): Promise<void>;
  /** true hanya bila status sebelumnya PENDING (transisi maju, idempotent). */
  markStatus(merchantOrderId: string, status: PaymentStatus, updatedAt: string): Promise<boolean>;
  findByProjectOrder(projectId: string, projectOrderId: string): Promise<TransactionRecord | null>;
  findWithProject(merchantOrderId: string): Promise<TransactionWithProject | null>;
  findPendingWithProjectBefore(cutoffIso: string, limit: number): Promise<TransactionWithProject[]>;
  deletePending(merchantOrderId: string): Promise<void>;
}

export interface WebhookLogEntry {
  merchantOrderId: string;
  attempt: number;
  httpStatus: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  status: "FAILED" | "DELIVERED" | "DEAD";
  createdAt: string;
}

export interface DueWebhookAttempt {
  id: number;
  merchantOrderId: string;
  attempt: number;
  nextAttemptAt: string;
}

export interface WebhookLogRepository {
  insertAttempt(entry: WebhookLogEntry): Promise<void>;
  findDue(nowIso: string, limit: number): Promise<DueWebhookAttempt[]>;
  /** true bila baris masih pada jadwal yang sama (tidak diambil proses lain). */
  claim(id: number, expectedNextAttemptAt: string, leaseUntil: string): Promise<boolean>;
  clearSchedule(id: number): Promise<void>;
  markDead(id: number): Promise<void>;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { project: ProjectRecord };
};
