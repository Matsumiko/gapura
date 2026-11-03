import type { Context } from "hono";
import type { Hono } from "hono";
import { merchantSettingsInputSchema } from "@gapura/shared/admin";
import { jsonError } from "../http";
import { PaymentProviderError } from "../providers/duitku";
import {
  SettingsInvalidError,
  SettingsNotFoundError,
  SettingsUnavailableError,
  type SettingsService,
} from "../services/settings";
import type { AppEnv, MerchantEnvironment } from "../types";

export interface SettingsRouteDeps {
  settings: SettingsService;
}

function parseEnvironment(value: string | undefined): MerchantEnvironment | null {
  return value === "sandbox" || value === "production" ? value : null;
}

function handleError(c: Context, error: unknown) {
  if (error instanceof SettingsUnavailableError) {
    return jsonError(c, 503, "SETTINGS_UNAVAILABLE", error.message);
  }
  if (error instanceof SettingsInvalidError) {
    return jsonError(c, 400, "INVALID_REQUEST", error.message);
  }
  if (error instanceof SettingsNotFoundError) {
    return jsonError(c, 404, "NOT_FOUND", error.message);
  }
  if (error instanceof PaymentProviderError) {
    if (error.code === "PROVIDER_NOT_CONFIGURED") {
      return jsonError(c, 503, "PROVIDER_NOT_CONFIGURED", error.message);
    }
    return jsonError(c, 502, "PROVIDER_ERROR", "Kredensial ditolak atau Duitku tidak bisa dihubungi.");
  }
  throw error;
}

export function registerSettingsRoutes(app: Hono<AppEnv>, deps: SettingsRouteDeps): void {
  app.get("/admin/settings", async (c) => c.json(await deps.settings.overview()));

  app.put("/admin/settings/:environment", async (c) => {
    const environment = parseEnvironment(c.req.param("environment"));
    if (!environment) {
      return jsonError(c, 400, "INVALID_REQUEST", "environment wajib sandbox atau production.");
    }
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = merchantSettingsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(c, 400, "INVALID_REQUEST", "Body kredensial tidak valid.");
    }
    try {
      return c.json(
        await deps.settings.save(environment, parsed.data, c.get("adminActor")),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/admin/settings/:environment/activate", async (c) => {
    const environment = parseEnvironment(c.req.param("environment"));
    if (!environment) {
      return jsonError(c, 400, "INVALID_REQUEST", "environment wajib sandbox atau production.");
    }
    try {
      return c.json(await deps.settings.activate(environment, c.get("adminActor")));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/admin/settings/:environment/test", async (c) => {
    const environment = parseEnvironment(c.req.param("environment"));
    if (!environment) {
      return jsonError(c, 400, "INVALID_REQUEST", "environment wajib sandbox atau production.");
    }
    try {
      return c.json(await deps.settings.test(environment));
    } catch (error) {
      return handleError(c, error);
    }
  });
}
