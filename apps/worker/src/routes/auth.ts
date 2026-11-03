import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { jsonError } from "../http";
import { AdminAuthError, type AdminAuthService } from "../services/admin-auth";
import { REAUTH_WINDOW_MS, type AdminSessionService } from "../services/admin-sessions";
import type { AppEnv } from "../types";

export const SESSION_COOKIE = "__Host-gapura_admin";
export const REAUTH_WINDOW_MINUTES = REAUTH_WINDOW_MS / 60_000;
const COOKIE_MAX_AGE = 60 * 60 * 24;
const CSRF_HEADER = "X-CSRF-Token";

export interface AuthRouteDeps {
  auth: AdminAuthService;
  sessions: AdminSessionService;
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

function clientIp(c: { req: { header(name: string): string | undefined } }): string | null {
  return c.req.header("CF-Connecting-IP") ?? null;
}

function authError(c: Parameters<typeof jsonError>[0], error: unknown) {
  if (error instanceof AdminAuthError) {
    const status = error.code === "rate_limited" ? 429 : error.code === "not_configured" ? 503 : 401;
    return jsonError(c, status, error.code.toUpperCase(), error.message);
  }
  throw error;
}

export function registerAuthRoutes(app: Hono<AppEnv>, deps: AuthRouteDeps): void {
  app.get("/admin/auth/status", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const found = token ? await deps.sessions.authenticate(token) : null;
    return c.json({
      ...(await deps.auth.status()),
      reauthWindowMinutes: REAUTH_WINDOW_MINUTES,
      authenticated: Boolean(found),
      admin: found
        ? { id: found.admin.id, email: found.admin.email, role: found.admin.role }
        : null,
    });
  });

  app.post("/admin/auth/bootstrap/start", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      setupToken?: unknown;
      email?: unknown;
    } | null;
    if (typeof body?.setupToken !== "string" || typeof body?.email !== "string") {
      return jsonError(c, 400, "INVALID_REQUEST", "setupToken dan email wajib.");
    }
    try {
      return c.json(await deps.auth.startBootstrap({ setupToken: body.setupToken, email: body.email }));
    } catch (error) {
      return authError(c, error);
    }
  });

  app.post("/admin/auth/bootstrap", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const fields = ["setupToken", "email", "password", "secret", "totpCode"] as const;
    if (!body || fields.some((field) => typeof body[field] !== "string")) {
      return jsonError(c, 400, "INVALID_REQUEST", "Data bootstrap tidak lengkap.");
    }
    try {
      const admin = await deps.auth.finishBootstrap({
        setupToken: String(body.setupToken),
        email: String(body.email),
        password: String(body.password),
        secret: String(body.secret),
        totpCode: String(body.totpCode),
      });
      const issued = await deps.sessions.issue({
        adminId: admin.id,
        ip: clientIp(c),
        userAgent: c.req.header("User-Agent") ?? null,
      });
      setSessionCookie(c, issued.token);
      return c.json({ admin, csrfToken: issued.csrfToken, expiresAt: issued.expiresAt }, 201);
    } catch (error) {
      return authError(c, error);
    }
  });

  app.post("/admin/auth/login", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || ["email", "password", "totpCode"].some((field) => typeof body[field] !== "string")) {
      return jsonError(c, 400, "INVALID_REQUEST", "email, password, dan totpCode wajib.");
    }
    try {
      const result = await deps.auth.login({
        email: String(body.email),
        password: String(body.password),
        totpCode: String(body.totpCode),
        ip: clientIp(c),
        userAgent: c.req.header("User-Agent") ?? null,
      });
      setSessionCookie(c, result.token);
      return c.json({ admin: result.admin, csrfToken: result.csrfToken, expiresAt: result.expiresAt });
    } catch (error) {
      return authError(c, error);
    }
  });

  app.post("/admin/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const found = await deps.sessions.authenticate(token);
      if (found) {
        const csrf = c.req.header(CSRF_HEADER);
        if (!csrf || !(await deps.sessions.verifyCsrf(found.session, csrf))) {
          return jsonError(c, 403, "CSRF_INVALID", "CSRF token tidak valid.");
        }
        await deps.sessions.revoke(token);
      }
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, sameSite: "Strict" });
    return c.json({ ok: true });
  });

  app.get("/admin/auth/session", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const found = token ? await deps.sessions.authenticate(token) : null;
    if (!found) {
      return jsonError(c, 401, "UNAUTHORIZED", "Sesi admin tidak valid.");
    }
    return c.json({
      admin: { id: found.admin.id, email: found.admin.email, role: found.admin.role },
      expiresAt: found.session.expiresAt,
    });
  });

  app.post("/admin/auth/reauth", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const found = token ? await deps.sessions.authenticate(token) : null;
    if (!found) {
      return jsonError(c, 401, "UNAUTHORIZED", "Sesi admin tidak valid.");
    }
    const csrf = c.req.header(CSRF_HEADER);
    if (!csrf || !(await deps.sessions.verifyCsrf(found.session, csrf))) {
      return jsonError(c, 403, "CSRF_INVALID", "CSRF token tidak valid.");
    }
    const body = (await c.req.json().catch(() => null)) as { totpCode?: unknown } | null;
    if (typeof body?.totpCode !== "string") {
      return jsonError(c, 400, "INVALID_REQUEST", "totpCode wajib.");
    }
    try {
      const at = await deps.auth.reauthenticate({
        userId: found.admin.id,
        sessionId: found.session.id,
        totpCode: body.totpCode,
      });
      return c.json({ ok: true, reauthenticatedAt: at });
    } catch (error) {
      return authError(c, error);
    }
  });
}
