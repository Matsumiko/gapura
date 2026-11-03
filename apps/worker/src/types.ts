export interface Env {
  DB_SANDBOX: D1Database;
  DB_PRODUCTION: D1Database;
  ENVIRONMENT?: string;
  PANEL_ORIGIN?: string;
  PUBLIC_BASE_URL?: string;
  DUITKU_BASE_URL?: string;
  DUITKU_MERCHANT_CODE?: string;
  DUITKU_API_KEY?: string;
  ADMIN_TOKEN?: string;
  CREDENTIALS_KEY?: string;
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
  /** Hapus riwayat selesai yang lebih tua dari cutoff; mengembalikan jumlah baris. */
  pruneTerminalBefore(cutoffIso: string): Promise<number>;
}

export interface AdminProject {
  id: string;
  name: string;
  prefix: string;
  webhookUrl: string;
  isActive: boolean;
  createdAt: string;
}

export interface AdminTransaction {
  merchantOrderId: string;
  projectId: string;
  projectName: string;
  projectOrderId: string;
  amount: number;
  paymentMethod: string | null;
  status: PaymentStatus;
  paymentUrl: string | null;
  reference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminWebhookLog {
  id: number;
  merchantOrderId: string;
  projectName: string;
  attempt: number;
  httpStatus: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  status: "FAILED" | "DELIVERED" | "DEAD";
  createdAt: string;
}

export interface AdminSummaryRow {
  projectId: string;
  projectName: string;
  todayCount: number;
  todayAmount: number;
  monthCount: number;
  monthAmount: number;
}

export interface AdminTransactionQuery {
  projectId?: string;
  status?: PaymentStatus;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export type MerchantEnvironment = "sandbox" | "production";

export interface AdminUser {
  id: string;
  email: string;
  role: "owner" | "admin" | "viewer";
  isActive: boolean;
  totpEnabled: boolean;
  totpLastCounter: number | null;
}

export interface AdminSession {
  id: string;
  adminId: string;
  csrfHash: string;
  ip: string | null;
  userAgent: string | null;
  expiresAt: string;
  lastSeenAt: string;
  reauthenticatedAt: string | null;
  createdAt: string;
}

export interface AdminSessionRepository {
  create(input: {
    id: string;
    adminId: string;
    tokenHash: string;
    csrfHash: string;
    ip: string | null;
    userAgent: string | null;
    expiresAt: string;
    now: string;
  }): Promise<void>;
  find(tokenHash: string): Promise<{ session: AdminSession; admin: AdminUser } | null>;
  touch(id: string, now: string): Promise<void>;
  revoke(id: string): Promise<void>;
  setReauthenticated(id: string, at: string): Promise<void>;
  deleteExpired(now: string): Promise<void>;
}

export interface MerchantCredentials {
  environment: MerchantEnvironment;
  merchantCode: string;
  apiKey: string;
  updatedAt: string;
  updatedBy: string;
}

export interface MerchantSettingsView {
  environment: MerchantEnvironment;
  merchantCode: string;
  apiKeySet: boolean;
  isActive: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SettingsRepository {
  list(): Promise<MerchantSettingsView[]>;
  get(environment: MerchantEnvironment): Promise<MerchantCredentials | null>;
  getActive(): Promise<MerchantCredentials | null>;
  upsert(input: {
    environment: MerchantEnvironment;
    merchantCode: string;
    apiKey?: string;
    updatedAt: string;
    updatedBy: string;
  }): Promise<boolean>;
  activate(environment: MerchantEnvironment): Promise<boolean>;
}

export interface AuditEntry {
  actorEmail: string;
  action: string;
  target: string | null;
  detail: string | null;
  createdAt: string;
}

export interface AdminRepository {
  listProjects(): Promise<AdminProject[]>;
  findProject(id: string): Promise<AdminProject | null>;
  insertProject(input: {
    id: string;
    name: string;
    prefix: string;
    apiKeyHash: string;
    webhookUrl: string;
    webhookSecret: string;
    createdAt: string;
  }): Promise<boolean>;
  setProjectActive(id: string, active: boolean): Promise<boolean>;
  updateProjectProfile(
    id: string,
    input: { name?: string; webhookUrl?: string },
  ): Promise<boolean>;
  updateProjectApiKeyHash(id: string, hash: string): Promise<boolean>;
  updateProjectWebhookSecret(id: string, secret: string): Promise<boolean>;
  listTransactions(
    query: AdminTransactionQuery,
  ): Promise<{ items: AdminTransaction[]; total: number }>;
  findTransaction(merchantOrderId: string): Promise<AdminTransaction | null>;
  listWebhookLogsFor(merchantOrderId: string): Promise<AdminWebhookLog[]>;
  listWebhookLogs(status: "FAILED" | "DEAD" | null, limit: number): Promise<AdminWebhookLog[]>;
  requeueWebhook(id: number, nowIso: string): Promise<boolean>;
  summary(dayStartIso: string, monthStartIso: string): Promise<AdminSummaryRow[]>;
  insertAudit(entry: AuditEntry): Promise<void>;
  listAudit(limit: number): Promise<AuditEntry[]>;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { project: ProjectRecord; adminActor: string };
};
