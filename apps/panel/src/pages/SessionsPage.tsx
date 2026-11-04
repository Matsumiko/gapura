import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, apiPost, type AdminSessionView } from "../api";
import {
  ErrorNote,
  PageHeader,
  TableSkeleton,
  formatTime,
} from "../components";

export function SessionsPage({ isOwner }: { isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"own" | "all">("own");

  const sessions = useQuery({
    queryKey: ["admin", "sessions", isOwner ? scope : "own"],
    queryFn: () =>
      apiGet<{ items: AdminSessionView[] }>(
        `/admin/sessions${isOwner && scope === "all" ? "?scope=all" : ""}`,
      ),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin", "sessions"] });
  }

  const revoke = useMutation({
    mutationFn: (session: AdminSessionView) =>
      apiPost<{ ok: boolean }>(`/admin/sessions/${session.id}/revoke`),
    onSuccess: refresh,
  });

  const revokeOthers = useMutation({
    mutationFn: () => apiPost<{ revoked: number }>("/admin/sessions/revoke-others"),
    onSuccess: refresh,
  });

  const items = sessions.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Sesi admin"
        lede="Sesi aktif dengan IP, user agent, waktu pakai terakhir, dan status reauth."
      />

      <section className="panel panel--flush">
        <div className="queue-bar">
          <div>
            <h2>Sesi aktif</h2>
            {isOwner ? (
              <label className="field field--inline">
                <span className="field__label">Cakupan</span>
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as "own" | "all")}
                >
                  <option value="own">Sesi saya</option>
                  <option value="all">Semua admin</option>
                </select>
              </label>
            ) : null}
          </div>
          <div className="row-actions">
            {sessions.data ? (
              <span className="panel-count">{items.length} sesi</span>
            ) : null}
            <button
              type="button"
              className="button"
              onClick={() => {
                if (window.confirm("Cabut semua sesi lain milik Anda?")) {
                  revokeOthers.mutate();
                }
              }}
              disabled={revokeOthers.isPending || items.length < 2}
            >
              {revokeOthers.isPending ? "Mencabut…" : "Cabut sesi lain saya"}
            </button>
          </div>
        </div>

        <div className="panel-body">
          <ErrorNote error={sessions.error ?? revoke.error ?? revokeOthers.error} />

          {sessions.isPending ? <TableSkeleton rows={4} cols={7} /> : null}

          {sessions.data ? (
            items.length === 0 ? (
              <p className="empty-note">Tidak ada sesi aktif.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {scope === "all" ? <th scope="col">Admin</th> : null}
                      <th scope="col">IP</th>
                      <th scope="col">User agent</th>
                      <th scope="col">Dibuat</th>
                      <th scope="col">Terakhir dipakai</th>
                      <th scope="col">Reauth</th>
                      <th scope="col">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((session) => (
                      <tr key={session.id}>
                        {scope === "all" ? (
                          <td data-label="Admin">
                            {session.adminEmail}{" "}
                            <span className="badge role">{session.adminRole}</span>
                          </td>
                        ) : null}
                        <td className="num" data-label="IP">
                          {session.ip ?? "-"}
                        </td>
                        <td className="wrap" data-label="User agent" title={session.userAgent ?? undefined}>
                          {session.userAgent ?? "-"}
                          {session.current ? (
                            <span className="badge good"> sesi ini</span>
                          ) : null}
                        </td>
                        <td className="cell-time" data-label="Dibuat">
                          {formatTime(session.createdAt)}
                        </td>
                        <td className="cell-time" data-label="Terakhir dipakai">
                          {formatTime(session.lastSeenAt)}
                        </td>
                        <td className="cell-time" data-label="Reauth">
                          {session.reauthenticatedAt
                            ? formatTime(session.reauthenticatedAt)
                            : "-"}
                        </td>
                        <td data-label="Aksi" className="actions">
                          {session.current ? (
                            <span className="muted">-</span>
                          ) : (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => revoke.mutate(session)}
                              disabled={revoke.isPending}
                            >
                              Cabut
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      </section>
    </>
  );
}
