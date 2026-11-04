import type { Context } from "hono";
import { jsonError } from "../http";
import { REAUTH_WINDOW_MS } from "../services/admin-sessions";
import type { AppEnv } from "../types";

export function requireOwner(c: Context<AppEnv>) {
  if (c.get("adminRole") !== "owner") {
    return jsonError(c, 403, "FORBIDDEN", "Aksi ini hanya untuk owner.");
  }
  return null;
}

/** Aksi manajemen admin butuh verifikasi TOTP ulang, sama seperti aksi sensitif lain. */
export function requireFreshReauth(
  c: Context<AppEnv>,
  now: () => Date = () => new Date(),
) {
  const reauthenticatedAt = c.get("adminReauthenticatedAt");
  const elapsed = reauthenticatedAt
    ? now().getTime() - new Date(reauthenticatedAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > REAUTH_WINDOW_MS) {
    return jsonError(
      c,
      403,
      "REAUTH_REQUIRED",
      "Aksi ini butuh verifikasi TOTP ulang.",
    );
  }
  return null;
}
