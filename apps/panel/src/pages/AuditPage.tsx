import { useQuery } from "@tanstack/react-query";
import { apiGet, type AuditLog } from "../api";
import {
  EmptyRow,
  ErrorNote,
  PageHeader,
  TableSkeleton,
  formatTime,
} from "../components";

export function AuditPage() {
  const audit = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => apiGet<{ items: AuditLog[] }>("/admin/audit?limit=100"),
  });

  return (
    <>
      <PageHeader
        title="Audit admin"
        lede="100 aksi admin terakhir. Detail tidak memuat secret."
      />

      <section className="panel panel--flush">
        <div className="panel-head panel-head--table">
          <h2>Riwayat aksi</h2>
          {audit.data ? (
            <span className="panel-count">{audit.data.items.length} aksi</span>
          ) : null}
        </div>

        <div className="panel-body">
          <ErrorNote error={audit.error} />

          {audit.isPending ? <TableSkeleton rows={10} cols={5} /> : null}

          {audit.data ? (
            <div className="table-wrap">
              <table className="data-table audit-table">
                <thead>
                  <tr>
                    <th scope="col">Waktu</th>
                    <th scope="col">Aktor</th>
                    <th scope="col">Aksi</th>
                    <th scope="col">Target</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.items.map((entry, index) => (
                    <tr key={`${entry.createdAt}-${index}`}>
                      <td className="cell-time" data-label="Waktu">{formatTime(entry.createdAt)}</td>
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
                  {audit.data.items.length === 0 ? (
                    <EmptyRow colSpan={5}>Belum ada aksi admin.</EmptyRow>
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
