import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { jsonError } from "../http";
import { SESSION_COOKIE } from "../routes/auth";
import {
  REAUTH_WINDOW_MS,
  type AdminSessionService,
} from "../services/admin-sessions";
import type { AppEnv } from "../types";

const WRITE_METHODS: Record<string, true> = {
  POST: true,
  PUT: true,
  PATCH: true,
  DELETE: true,
};
const CSRF_HEADER = "X-CSRF-Token";

export interface AdminAuthMiddlewareDeps {
  sessions?: AdminSessionService;
  now?: () => Date;
}

export interface AdminOriginMiddlewareDeps {
  panelOrigins?: string[];
}

/** Hanya origin panel yang terdaftar boleh mengirim request yang mengubah state. */
export function requireAdminOrigin(deps: AdminOriginMiddlewareDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    const origin = c.req.header("Origin");
    if (
      WRITE_METHODS[method] === true &&
      origin &&
      deps.panelOrigins &&
      !deps.panelOrigins.includes(origin)
    ) {
      return jsonError(c, 403, "ORIGIN_DENIED", "Origin tidak diizinkan.");
    }
    await next();
  };
}

const SENSITIVE_WRITES: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/admin\/projects$/ },
  { method: "PATCH", pattern: /^\/admin\/projects\/[^/]+$/ },
  { method: "POST", pattern: /^\/admin\/projects\/[^/]+\/rotate-(key|secret)$/ },
  { method: "PUT", pattern: /^\/admin\/settings\/[^/]+$/ },
  { method: "POST", pattern: /^\/admin\/settings\/[^/]+\/activate$/ },
  { method: "POST", pattern: /^\/admin\/webhooks\/[^/]+\/retry$/ },
];

function isSensitiveWrite(method: string, path: string): boolean {
  const relative = path.replace(/^\/(sandbox|production)(?=\/)/, "");
  return SENSITIVE_WRITES.some((entry) => entry.method === method && entry.pattern.test(relative));
}

function isFreshReauth(reauthenticatedAt: string | null, nowMs: number): boolean {
  if (!reauthenticatedAt) {
    return false;
  }
  const elapsed = nowMs - new Date(reauthenticatedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= REAUTH_WINDOW_MS;
}

/**
 * Auth admin berbasis sesi opaque dari cookie:
 * - baca: semua sesi aktif;
 * - tulis: role owner/admin + CSRF;
 * - aksi sensitif: reauth TOTP dalam 15 menit terakhir.
 */
export function requireAdminAuth(deps: AdminAuthMiddlewareDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!deps.sessions) {
      return jsonError(c, 503, "ADMIN_NOT_CONFIGURED", "Auth admin belum dikonfigurasi.");
    }

    const token = getCookie(c, SESSION_COOKIE);
    const found = token ? await deps.sessions.authenticate(token) : null;
    if (!found) {
      return jsonError(c, 401, "ADMIN_UNAUTHORIZED", "Sesi admin tidak valid.");
    }

    const method = c.req.method.toUpperCase();
    const isWrite = WRITE_METHODS[method] === true;

    if (isWrite && found.admin.role === "viewer") {
      return jsonError(c, 403, "FORBIDDEN", "Role viewer tidak boleh mengubah data.");
    }

    if (isWrite) {
      const csrf = c.req.header(CSRF_HEADER);
      if (!csrf || !(await deps.sessions.verifyCsrf(found.session, csrf))) {
        return jsonError(c, 403, "CSRF_INVALID", "CSRF token tidak valid.");
      }
      const nowMs = deps.now ? deps.now().getTime() : Date.now();
      if (
        isSensitiveWrite(method, c.req.path) &&
        !isFreshReauth(found.session.reauthenticatedAt, nowMs)
      ) {
        return jsonError(
          c,
          403,
          "REAUTH_REQUIRED",
          "Aksi sensitif butuh verifikasi TOTP ulang.",
        );
      }
    }

    c.set("adminActor", found.admin.email);
    c.set("adminRole", found.admin.role);
    c.set("adminSessionId", found.session.id);
    c.set("adminReauthenticatedAt", found.session.reauthenticatedAt);
    await next();
  };
}
