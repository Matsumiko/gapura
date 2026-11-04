import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  activateAdminInputSchema,
  createAdminInputSchema,
  resetAdminPasswordInputSchema,
} from "@gapura/shared/admin";
import { jsonError } from "../http";
import { createAdminManagementRepository } from "../repositories/admin-management";
import { createAdminRecoveryRepository } from "../repositories/admin-recovery";
import {
  AdminManagementError,
  createAdminManagementService,
  type AdminManagementService,
} from "../services/admin-management";
import { createAdminRecoveryService } from "../services/admin-recovery";
import { createCredentialCipher, type CredentialCipher } from "../services/credentials";
import type { AppEnv } from "../types";
import { requireFreshReauth, requireOwner } from "./admin-guards";

export interface AdminManagementRouteDeps {
  now?: () => Date;
  issuer: string;
}

const ERROR_STATUS: Record<AdminManagementError["code"], ContentfulStatusCode> = {
  not_found: 404,
  conflict: 409,
  invalid_totp: 400,
  not_configured: 503,
  self_action: 409,
};

const cipherCache = new Map<string, Promise<CredentialCipher>>();

function cipherFor(key: string | undefined): Promise<CredentialCipher | null> {
  if (!key) {
    return Promise.resolve(null);
  }
  let cipher = cipherCache.get(key);
  if (!cipher) {
    cipher = createCredentialCipher(key).catch((error: unknown) => {
      cipherCache.delete(key);
      throw error;
    });
    cipherCache.set(key, cipher);
  }
  return cipher;
}

function serviceFor(
  c: Context<AppEnv>,
  deps: AdminManagementRouteDeps,
): AdminManagementService {
  const now = deps.now ?? (() => new Date());
  const repo = createAdminManagementRepository(c.env.DB_AUTH);
  return createAdminManagementService({
    repo,
    recovery: createAdminRecoveryService({
      repo: createAdminRecoveryRepository(c.env.DB_AUTH),
      now,
    }),
    getCipher: () => cipherFor(c.env.CREDENTIALS_KEY),
    issuer: deps.issuer,
    now,
  });
}

function managementError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof AdminManagementError) {
    return jsonError(c, ERROR_STATUS[error.code], error.code.toUpperCase(), error.message);
  }
  throw error;
}

async function readJson(c: Context<AppEnv>): Promise<unknown> {
  return c.req.json().catch(() => null);
}

export function registerAdminManagementRoutes(
  app: Hono<AppEnv>,
  deps: AdminManagementRouteDeps,
): void {
  const now = deps.now ?? (() => new Date());

  app.get("/admin/admins", async (c) => {
    const denied = requireOwner(c);
    if (denied) {
      return denied;
    }
    return c.json({ items: await serviceFor(c, deps).list() });
  });

  app.post("/admin/admins", async (c) => {
    const denied = requireOwner(c) ?? requireFreshReauth(c, now);
    if (denied) {
      return denied;
    }
    const parsed = createAdminInputSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "Body admin tidak valid.");
    }
    try {
      const created = await serviceFor(c, deps).create({
        ...parsed.data,
        actor: c.get("adminActor"),
      });
      return c.json(created, 201);
    } catch (error) {
      return managementError(c, error);
    }
  });

  app.post("/admin/admins/:id/activate", async (c) => {
    const denied = requireOwner(c) ?? requireFreshReauth(c, now);
    if (denied) {
      return denied;
    }
    const parsed = activateAdminInputSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "Kode TOTP wajib 6 digit.");
    }
    try {
      return c.json(
        await serviceFor(c, deps).activate({
          id: c.req.param("id"),
          totpCode: parsed.data.totpCode,
          actor: c.get("adminActor"),
        }),
      );
    } catch (error) {
      return managementError(c, error);
    }
  });

  app.post("/admin/admins/:id/deactivate", async (c) => {
    const denied = requireOwner(c) ?? requireFreshReauth(c, now);
    if (denied) {
      return denied;
    }
    try {
      return c.json({
        admin: await serviceFor(c, deps).deactivate({
          id: c.req.param("id"),
          actor: c.get("adminActor"),
          actorEmail: c.get("adminActor"),
        }),
      });
    } catch (error) {
      return managementError(c, error);
    }
  });

  app.post("/admin/admins/:id/reset-password", async (c) => {
    const denied = requireOwner(c) ?? requireFreshReauth(c, now);
    if (denied) {
      return denied;
    }
    const raw = (await readJson(c)) ?? {};
    const parsed = resetAdminPasswordInputSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "Password minimal 12 karakter.");
    }
    try {
      return c.json(
        await serviceFor(c, deps).resetPassword({
          id: c.req.param("id"),
          password: parsed.data.password,
          actor: c.get("adminActor"),
        }),
      );
    } catch (error) {
      return managementError(c, error);
    }
  });

  app.post("/admin/admins/:id/reset-totp", async (c) => {
    const denied = requireOwner(c) ?? requireFreshReauth(c, now);
    if (denied) {
      return denied;
    }
    try {
      return c.json(
        await serviceFor(c, deps).resetTotp({
          id: c.req.param("id"),
          actor: c.get("adminActor"),
        }),
      );
    } catch (error) {
      return managementError(c, error);
    }
  });

  app.post("/admin/admins/:id/recovery-codes", async (c) => {
    const denied = requireOwner(c) ?? requireFreshReauth(c, now);
    if (denied) {
      return denied;
    }
    try {
      return c.json(
        await serviceFor(c, deps).regenerateRecoveryCodes({
          id: c.req.param("id"),
          actor: c.get("adminActor"),
        }),
      );
    } catch (error) {
      return managementError(c, error);
    }
  });
}
