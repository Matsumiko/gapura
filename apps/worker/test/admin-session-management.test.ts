import { describe, expect, it } from "vitest";
import { generateApiKey, generateWebhookSecret, sha256Hex } from "@gapura/shared/crypto";
import { createAdminRepository } from "../src/repositories/admin";
import { createAdminSessionRepository } from "../src/repositories/admin-sessions";
import { createProjectsRepository } from "../src/repositories/projects";
import { createAdminService } from "../src/services/admin";
import { createAdminSessionService } from "../src/services/admin-sessions";
import type { AdminRole, AppEnv, Env } from "../src/types";
import type { Hono } from "hono";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_payment_artifacts.sql?raw";
import schema3 from "../migrations/0003_admin_audit.sql?raw";
import schema4 from "../migrations/0004_merchant_settings.sql?raw";
import schema5 from "../migrations/0005_admin_auth.sql?raw";
import schema6 from "../migrations/0006_admin_ops.sql?raw";
import {
  adminHeaders,
  seedAdminSession,
  type SeededAdminSession,
} from "./support/admin-session";
import { createTestApp } from "./support/harness";
import { createTestDatabase } from "./support/d1";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const SCHEMA = `${schema1}\n${schema2}\n${schema3}\n${schema4}\n${schema5}\n${schema6}`;

async function setup(options: { role?: AdminRole } = {}) {
  const db = createTestDatabase(SCHEMA);
  const session = await seedAdminSession(db, {
    role: options.role,
    now: NOW,
    reauthenticatedAt: NOW.toISOString(),
  });
  const sessions = createAdminSessionService({
    repo: createAdminSessionRepository(db),
    now: () => NOW,
  });
  const admin = createAdminService({
    admin: createAdminRepository(db),
    now: () => NOW,
    generateApiKey,
    generateWebhookSecret,
    sha256Hex,
  });
  const test = await createTestApp(
    {
      projects: createProjectsRepository(db),
      admin,
      adminSessions: sessions,
      now: () => NOW,
    },
    { DB_AUTH: db },
  );
  return { ...test, db, session, sessions };
}

interface SessionItem {
  id: string;
  adminEmail: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  reauthenticatedAt: string | null;
  idleExpiresAt: string;
}

async function listSessions(
  app: Hono<AppEnv>,
  env: Env,
  session: SeededAdminSession,
  query = "",
) {
  const response = await app.request(
    `/admin/sessions${query}`,
    { headers: adminHeaders(session) },
    env,
  );
  return {
    response,
    body: (await response.json()) as { items: SessionItem[] },
  };
}

describe("manajemen sesi admin", () => {
  it("menampilkan sesi aktif dengan ip, user agent, dan waktu", async () => {
    const { app, env, session, sessions } = await setup();
    await sessions.issue({ adminId: session.adminId, ip: "10.0.0.2", userAgent: "Firefox" });

    const { response, body } = await listSessions(app, env, session);

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    const current = body.items.find((item) => item.current);
    expect(current).toBeDefined();
    const other = body.items.find((item) => !item.current);
    expect(other).toMatchObject({ ip: "10.0.0.2", userAgent: "Firefox" });
    expect(other?.idleExpiresAt).toBeTruthy();
    expect(other?.reauthenticatedAt).toBeNull();
  });

  it("menghapus sesi yang idle dari daftar", async () => {
    const { app, env, session, sessions, db } = await setup();
    await sessions.issue({ adminId: session.adminId, ip: null, userAgent: "lama" });
    await db
      .prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE user_agent = 'lama'")
      .bind(new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString())
      .run();

    const { body } = await listSessions(app, env, session);

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.current).toBe(true);
    const stale = await db
      .prepare("SELECT COUNT(*) AS total FROM admin_sessions WHERE user_agent = 'lama'")
      .first<{ total: number }>();
    expect(stale?.total).toBe(0);
  });

  it("authenticate menolak sesi yang melewati idle timeout", async () => {
    const db = createTestDatabase(SCHEMA);
    const old = new Date(NOW.getTime() - 3 * 60 * 60 * 1000);
    const staleSession = await seedAdminSession(db, {
      now: old,
      reauthenticatedAt: old.toISOString(),
    });
    const sessions = createAdminSessionService({
      repo: createAdminSessionRepository(db),
      now: () => NOW,
    });
    const admin = createAdminService({
      admin: createAdminRepository(db),
      now: () => NOW,
      generateApiKey,
      generateWebhookSecret,
      sha256Hex,
    });
    const test = await createTestApp(
      {
        projects: createProjectsRepository(db),
        admin,
        adminSessions: sessions,
        now: () => NOW,
      },
      { DB_AUTH: db },
    );

    const response = await test.app.request(
      "/admin/summary",
      { headers: { Cookie: staleSession.cookie } },
      test.env,
    );
    expect(response.status).toBe(401);
  });

  it("mencabut satu sesi dan semua sesi lain", async () => {
    const { app, env, session, sessions } = await setup();
    const one = await sessions.issue({ adminId: session.adminId, ip: null, userAgent: "satu" });
    const two = await sessions.issue({ adminId: session.adminId, ip: null, userAgent: "dua" });

    const listed = await listSessions(app, env, session);
    const target = listed.body.items.find((item) => item.userAgent === "satu");
    expect(target).toBeDefined();

    const revokeOne = await app.request(
      `/admin/sessions/${target?.id}/revoke`,
      { method: "POST", headers: adminHeaders(session) },
      env,
    );
    expect(revokeOne.status).toBe(200);
    expect((await listSessions(app, env, session)).body.items).toHaveLength(2);

    const revokeOthers = await app.request(
      "/admin/sessions/revoke-others",
      { method: "POST", headers: adminHeaders(session) },
      env,
    );
    expect(revokeOthers.status).toBe(200);
    expect(await revokeOthers.json()).toEqual({ revoked: 1 });
    const remaining = await listSessions(app, env, session);
    expect(remaining.body.items).toHaveLength(1);
    expect(remaining.body.items[0]?.current).toBe(true);

    const stale = await app.request(
      "/admin/summary",
      { headers: { Cookie: `__Host-gapura_admin=${one.token}` } },
      env,
    );
    expect(stale.status).toBe(401);
    const staleTwo = await app.request(
      "/admin/summary",
      { headers: { Cookie: `__Host-gapura_admin=${two.token}` } },
      env,
    );
    expect(staleTwo.status).toBe(401);
  });

  it("owner bisa melihat semua sesi dan mencabut sesi admin lain", async () => {
    const { app, env, session, sessions, db } = await setup();
    const otherAdmin = await seedAdminSession(db, {
      adminId: "admin-lain",
      email: "lain@example.com",
      role: "admin",
      now: NOW,
      reauthenticatedAt: NOW.toISOString(),
    });
    const otherIssued = await sessions.issue({
      adminId: otherAdmin.adminId,
      ip: "10.0.0.9",
      userAgent: "lain",
    });
    expect(otherAdmin.cookie).toContain("__Host-gapura_admin=");

    const all = await listSessions(app, env, session, "?scope=all");
    expect(all.response.status).toBe(200);
    expect(all.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ adminEmail: "lain@example.com", ip: "10.0.0.9" }),
      ]),
    );

    const target = all.body.items.find(
      (item) => item.adminEmail === "lain@example.com" && item.ip === "10.0.0.9",
    );
    const revoke = await app.request(
      `/admin/sessions/${target?.id}/revoke`,
      { method: "POST", headers: adminHeaders(session) },
      env,
    );
    expect(revoke.status).toBe(200);

    const revoked = await app.request(
      "/admin/summary",
      { headers: { Cookie: `__Host-gapura_admin=${otherIssued.token}` } },
      env,
    );
    expect(revoked.status).toBe(401);
  });

  it("admin biasa tidak boleh meminta daftar semua sesi atau mencabut sesi admin lain", async () => {
    const { app, env, session, sessions, db } = await setup({ role: "admin" });
    const other = await seedAdminSession(db, {
      adminId: "owner-lain",
      email: "owner@example.com",
      role: "owner",
      now: NOW,
      reauthenticatedAt: NOW.toISOString(),
    });
    const otherIssued = await sessions.issue({
      adminId: other.adminId,
      ip: null,
      userAgent: "owner",
    });

    const all = await listSessions(app, env, session, "?scope=all");
    expect(all.response.status).toBe(403);

    const listed = await listSessions(app, env, session);
    expect(listed.body.items).toHaveLength(1);
    const foreign = await db
      .prepare("SELECT id FROM admin_sessions WHERE admin_id = ?")
      .bind(other.adminId)
      .first<{ id: string }>();
    const revoke = await app.request(
      `/admin/sessions/${foreign?.id}/revoke`,
      { method: "POST", headers: adminHeaders(session) },
      env,
    );
    expect(revoke.status).toBe(403);
    const still = await app.request(
      "/admin/summary",
      { headers: { Cookie: `__Host-gapura_admin=${otherIssued.token}` } },
      env,
    );
    expect(still.status).toBe(200);
  });
});
