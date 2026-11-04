export interface Project {
  id: string;
  name: string;
  prefix: string;
  webhookUrl: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreatedProject {
  project: Project;
  apiKey: string;
  webhookSecret: string;
}

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED";

export interface Transaction {
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

export interface WebhookLog {
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

export interface SummaryRow {
  projectId: string;
  projectName: string;
  todayCount: number;
  todayAmount: number;
  monthCount: number;
  monthAmount: number;
}

export interface Summary {
  today: { count: number; amount: number };
  month: { count: number; amount: number };
  projects: SummaryRow[];
}

export interface TransactionDetail {
  transaction: Transaction;
  webhooks: WebhookLog[];
}

export type AdminRole = "owner" | "admin" | "viewer";

export interface AdminIdentity {
  id: string;
  email: string;
  role: AdminRole;
}

export interface AuthStatus {
  needsBootstrap: boolean;
  setupTokenConfigured: boolean;
  reauthWindowMinutes: number;
  authenticated: boolean;
  admin: AdminIdentity | null;
}

export interface SessionResult {
  admin: AdminIdentity;
  csrfToken: string;
  expiresAt: string;
}

export interface BootstrapStartResult {
  secret: string;
  otpauthUri: string;
}

export interface ReauthResult {
  ok: boolean;
  reauthenticatedAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const apiBaseUrl: string = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787";

const CSRF_KEY = "gapura.admin.csrf";
const ENV_KEY = "gapura.admin.environment";

export type ApiEnvironment = "sandbox" | "production";

export function getApiEnvironment(): ApiEnvironment {
  return localStorage.getItem(ENV_KEY) === "production" ? "production" : "sandbox";
}

export function setApiEnvironment(environment: ApiEnvironment): void {
  localStorage.setItem(ENV_KEY, environment);
}

let csrfToken: string | null = sessionStorage.getItem(CSRF_KEY);
let unauthorizedHandler: (() => void) | null = null;
let reauthHandler: (() => Promise<boolean>) | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
  if (token) {
    sessionStorage.setItem(CSRF_KEY, token);
  } else {
    sessionStorage.removeItem(CSRF_KEY);
  }
}

export function clearAuthState(): void {
  setCsrfToken(null);
}

export function configureApiAuth(handlers: {
  onUnauthorized?: () => void;
  onReauthRequired?: () => Promise<boolean>;
}): void {
  unauthorizedHandler = handlers.onUnauthorized ?? null;
  reauthHandler = handlers.onReauthRequired ?? null;
}

const WRITE_METHODS: Record<string, true> = {
  POST: true,
  PUT: true,
  PATCH: true,
  DELETE: true,
};

const AUTH_CREDENTIAL_PATHS = /\/admin\/auth\/(login|bootstrap|status|reauth)/;

interface ApiErrorBody {
  error?: { code?: unknown; message?: unknown };
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (WRITE_METHODS[method] === true && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const scopedPath = path.startsWith("/admin") ? `/${getApiEnvironment()}${path}` : path;
  const response = await fetch(`${apiBaseUrl}${scopedPath}`, {
    ...init,
    method,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    const code = typeof body?.error?.code === "string" ? body.error.code : null;
    const message =
      typeof body?.error?.message === "string" ? body.error.message : `HTTP ${response.status}`;

    if (response.status === 401 && !AUTH_CREDENTIAL_PATHS.test(scopedPath)) {
      clearAuthState();
      unauthorizedHandler?.();
    }
    if (
      response.status === 403 &&
      code === "REAUTH_REQUIRED" &&
      !retried &&
      reauthHandler
    ) {
      const reauthenticated = await reauthHandler();
      if (reauthenticated) {
        return request<T>(path, init, true);
      }
    }

    throw new ApiError(message, response.status, code);
  }

  return (await response.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return apiGet<AuthStatus>("/admin/auth/status");
}

export async function startBootstrap(input: {
  setupToken: string;
  email: string;
}): Promise<BootstrapStartResult> {
  return apiPost<BootstrapStartResult>("/admin/auth/bootstrap/start", input);
}

export async function finishBootstrap(input: {
  setupToken: string;
  email: string;
  password: string;
  secret: string;
  totpCode: string;
}): Promise<SessionResult> {
  const result = await apiPost<SessionResult>("/admin/auth/bootstrap", input);
  setCsrfToken(result.csrfToken);
  return result;
}

export async function loginAdmin(input: {
  email: string;
  password: string;
  totpCode: string;
}): Promise<SessionResult> {
  const result = await apiPost<SessionResult>("/admin/auth/login", input);
  setCsrfToken(result.csrfToken);
  return result;
}

export async function logoutAdmin(): Promise<void> {
  try {
    await apiPost<{ ok: boolean }>("/admin/auth/logout");
  } finally {
    clearAuthState();
  }
}

export function reauthenticate(totpCode: string): Promise<ReauthResult> {
  return apiPost<ReauthResult>("/admin/auth/reauth", { totpCode });
}

export type MerchantEnvironment = "sandbox" | "production";

export interface MerchantSettingsView {
  environment: MerchantEnvironment;
  merchantCode: string;
  apiKeySet: boolean;
  isActive: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SettingsOverview {
  activeEnvironment: MerchantEnvironment | null;
  callbackUrl: string;
  credentialsKeyConfigured: boolean;
  items: MerchantSettingsView[];
}

export interface SettingsTestResult {
  environment: MerchantEnvironment;
  count: number;
  sample: Array<{ code: string; name: string; totalFee: string }>;
}

export interface AuditLog {
  actorEmail: string;
  action: string;
  target: string | null;
  detail: string | null;
  createdAt: string;
}

export interface ManagedAdmin {
  id: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedAdminResult {
  admin: ManagedAdmin;
  initialPassword: string;
  secret: string;
  otpauthUri: string;
}

export interface ActivatedAdminResult {
  admin: ManagedAdmin;
  recoveryCodes: string[];
}

export interface ResetAdminPasswordResult {
  admin: ManagedAdmin;
  newPassword: string;
}

export interface ResetAdminTotpResult {
  admin: ManagedAdmin;
  secret: string;
  otpauthUri: string;
}

export interface AdminSessionView {
  id: string;
  adminId: string;
  adminEmail: string;
  adminRole: AdminRole;
  ip: string | null;
  userAgent: string | null;
  expiresAt: string;
  lastSeenAt: string;
  reauthenticatedAt: string | null;
  createdAt: string;
  current: boolean;
  idleExpiresAt: string;
}

export interface WebhookCounts {
  pending: number;
  failed: number;
  delivered: number;
  dead: number;
  total: number;
}
