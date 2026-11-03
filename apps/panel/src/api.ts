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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const apiBaseUrl: string = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787";

const TOKEN_KEY = "gapura.admin.token";

export function getAdminToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export function setAdminToken(token: string): void {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  if (!token) {
    throw new ApiError("Token admin belum diisi.", 401);
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new ApiError(body?.error?.message ?? `HTTP ${response.status}`, response.status);
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

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}
