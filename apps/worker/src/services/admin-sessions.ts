import { sha256Hex } from "@gapura/shared/crypto";
import { secureEqual } from "@gapura/shared/hmac";
import type { AdminSession, AdminSessionRepository, AdminUser } from "../types";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const REAUTH_WINDOW_MS = 15 * 60_000;

export interface IssuedSession {
  token: string;
  csrfToken: string;
  expiresAt: string;
}

export interface AuthenticatedSession {
  session: AdminSession;
  admin: AdminUser;
}

export interface AdminSessionService {
  issue(input: { adminId: string; ip: string | null; userAgent: string | null }): Promise<IssuedSession>;
  authenticate(token: string): Promise<AuthenticatedSession | null>;
  revoke(token: string): Promise<void>;
  reauthenticate(sessionId: string): Promise<string>;
  verifyCsrf(session: AdminSession, csrfToken: string): Promise<boolean>;
  cleanup(): Promise<void>;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createAdminSessionService(deps: {
  repo: AdminSessionRepository;
  now: () => Date;
  sessionTtlMs?: number;
}): AdminSessionService {
  const ttl = deps.sessionTtlMs ?? SESSION_TTL_MS;

  return {
    async issue({ adminId, ip, userAgent }): Promise<IssuedSession> {
      const token = randomToken();
      const csrfToken = randomToken();
      const now = deps.now();
      const expiresAt = new Date(now.getTime() + ttl).toISOString();
      await deps.repo.create({
        id: crypto.randomUUID(),
        adminId,
        tokenHash: await sha256Hex(token),
        csrfHash: await sha256Hex(csrfToken),
        ip,
        userAgent,
        expiresAt,
        now: now.toISOString(),
      });
      return { token, csrfToken, expiresAt };
    },

    async authenticate(token: string): Promise<AuthenticatedSession | null> {
      const found = await deps.repo.find(await sha256Hex(token));
      if (!found) {
        return null;
      }
      const now = deps.now();
      if (new Date(found.session.expiresAt).getTime() <= now.getTime()) {
        await deps.repo.revoke(found.session.id);
        return null;
      }
      if (!found.admin.isActive || !found.admin.totpEnabled) {
        return null;
      }
      await deps.repo.touch(found.session.id, now.toISOString());
      return found;
    },

    async revoke(token: string): Promise<void> {
      const found = await deps.repo.find(await sha256Hex(token));
      if (found) {
        await deps.repo.revoke(found.session.id);
      }
    },

    async reauthenticate(sessionId: string): Promise<string> {
      const at = deps.now().toISOString();
      await deps.repo.setReauthenticated(sessionId, at);
      return at;
    },

    async verifyCsrf(session: AdminSession, csrfToken: string): Promise<boolean> {
      return secureEqual(await sha256Hex(csrfToken), session.csrfHash);
    },

    async cleanup(): Promise<void> {
      await deps.repo.deleteExpired(deps.now().toISOString());
    },
  };
}
