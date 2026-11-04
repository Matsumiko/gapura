import { useQuery } from "@tanstack/react-query";
import { apiGet, type AuditLog } from "../api";
import {
  EmptyRow,
  ErrorNote,
  PageHeader,
  TableSkeleton,
  formatTime,
} from "../components";

interface AuditRow extends AuditLog {
  source: "Aksi" | "Auth";
}

export function AuditPage({ canViewAuthAudit }: { canViewAuthAudit: boolean }) {
  const audit = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => apiGet<{ items: AuditLog[] }>("/admin/audit?limit=100"),
  });
  const authAudit = useQuery({
    queryKey: ["admin", "audit-auth"],
    queryFn: () => apiGet<{ items: AuditLog[] }>("/admin/auth/audit?limit=100"),
    enabled: canViewAuthAudit,
    retry: false,
  });

  const rows: AuditRow[] = [
    ...(audit.data?.items ?? []).map((entry) => ({ ...entry, source: "Aksi" as const })),
    ...(authAudit.data?.items ?? []).map((entry) => ({ ...entry, source: "Auth" as const })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <>
      <PageHeader
        title="Audit admin"
        lede="Aksi admin di environment ini digabung dengan peristiwa login dan keamanan dari DB auth."
      />

      <section className="panel panel--flush">
        <div className="panel-head panel-head--table">
          <h2>Riwayat aksi</h2>
          {audit.data || authAudit.data ? (
            <span className="panel-count">{rows.length} aksi</span>
          ) : null}
        </div>

        <div className="panel-body">
          <ErrorNote error={audit.error} />
          {canViewAuthAudit ? <ErrorNote error={authAudit.error} /> : null}

          {audit.isPending || (canViewAuthAudit && authAudit.isPending) ? (
            <TableSkeleton rows={10} cols={6} />
          ) : null}

          {audit.data || authAudit.data ? (
            <div className="table-wrap">
              <table className="data-table audit-table">
                <thead>
                  <tr>
                    <th scope="col">Waktu</th>
                    <th scope="col">Sumber</th>
                    <th scope="col">Aktor</th>
                    <th scope="col">Aksi</th>
                    <th scope="col">Target</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry, index) => (
                    <tr key={`${entry.source}-${entry.createdAt}-${index}`}>
                      <td className="cell-time" data-label="Waktu">{formatTime(entry.createdAt)}</td>
                      <td data-label="Sumber">
                        <span className={`badge ${entry.source === "Auth" ? "role" : ""}`}>
                          {entry.source}
                        </span>
                      </td>
                      <td data-label="Aktor">{entry.actorEmail}</td>
                      <td data-label="Aksi">
                        <code>{entry.action}</code>
                      </td>
                      <td data-label="Target">
                        <code title={entry.target ?? undefined}>{entry.target ?? "-"}</code>
                      </td>
                      <td className="wrap" data-label="Detail">
                        <code className="audit-detail" title={entry.detail ?? undefined}>
                          {entry.detail ?? "-"}
                        </code>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <EmptyRow colSpan={6}>Belum ada aksi admin.</EmptyRow>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
