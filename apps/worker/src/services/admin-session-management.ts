import type {
  AdminSessionService,
  AuthenticatedSession,
} from "./admin-sessions";
import type {
  AdminSessionListRecord,
  AdminSessionManagementRepository,
} from "../repositories/admin-session-management";
import type { AdminRole } from "../types";

/** Sesi menganggur lebih lama dari ini dianggap tidak aktif. */
export const SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export interface AdminSessionView extends AdminSessionListRecord {
  current: boolean;
  idleExpiresAt: string;
}

export type SessionManagementErrorCode = "forbidden" | "not_found";

export class SessionManagementError extends Error {
  constructor(
    readonly code: SessionManagementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionManagementError";
  }
}

export interface AdminSessionManagementService {
  list(input: {
    actorId: string;
    role: AdminRole;
    currentSessionId: string;
    scope: "own" | "all";
  }): Promise<AdminSessionView[]>;
  revoke(input: { sessionId: string; actorId: string; role: AdminRole }): Promise<boolean>;
  revokeOthers(input: { actorId: string; currentSessionId: string }): Promise<number>;
}

export function isSessionIdle(
  lastSeenAt: string,
  now: Date,
  idleMs: number = SESSION_IDLE_TIMEOUT_MS,
): boolean {
  const lastSeen = new Date(lastSeenAt).getTime();
  return Number.isFinite(lastSeen) && now.getTime() - lastSeen > idleMs;
}

export function createAdminSessionManagementService(deps: {
  repo: AdminSessionManagementRepository;
  now: () => Date;
  idleMs?: number;
}): AdminSessionManagementService {
  const idleMs = deps.idleMs ?? SESSION_IDLE_TIMEOUT_MS;

  return {
    async list({ actorId, role, currentSessionId, scope }): Promise<AdminSessionView[]> {
      if (scope === "all" && role !== "owner") {
        throw new SessionManagementError("forbidden", "Hanya owner yang bisa melihat semua sesi.");
      }
      const now = deps.now();
      const nowIso = now.toISOString();
      const idleBefore = new Date(now.getTime() - idleMs).toISOString();
      await deps.repo.deleteInactive(nowIso, idleBefore);
      const rows = await deps.repo.list(scope === "all" ? null : actorId, nowIso);
      return rows.map((row) => ({
        ...row,
        current: row.id === currentSessionId,
        idleExpiresAt: new Date(new Date(row.lastSeenAt).getTime() + idleMs).toISOString(),
      }));
    },

    async revoke({ sessionId, actorId, role }): Promise<boolean> {
      const session = await deps.repo.find(sessionId);
      if (!session) {
        return false;
      }
      if (role !== "owner" && session.adminId !== actorId) {
        throw new SessionManagementError("forbidden", "Sesi milik admin lain.");
      }
      return deps.repo.revoke(session.id);
    },

    async revokeOthers({ actorId, currentSessionId }): Promise<number> {
      return deps.repo.revokeOthers(actorId, currentSessionId);
    },
  };
}

/**
 * Bungkus service sesi WS1 dengan kebijakan idle. authenticate() milik service asli
 * sudah memperbarui last_seen_at, tetapi objek sesi yang dikembalikan masih memuat
 * nilai sebelumnya, sehingga idle bisa dideteksi sebelum request diteruskan.
 */
export function withIdleTimeout(
  sessions: AdminSessionService,
  options: { now?: () => Date; idleMs?: number } = {},
): AdminSessionService {
  const idleMs = options.idleMs ?? SESSION_IDLE_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  return {
    ...sessions,

    async authenticate(token: string): Promise<AuthenticatedSession | null> {
      const found = await sessions.authenticate(token);
      if (!found) {
        return null;
      }
      if (isSessionIdle(found.session.lastSeenAt, now(), idleMs)) {
        await sessions.revoke(token);
        return null;
      }
      return found;
    },
  };
}
