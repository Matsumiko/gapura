import { useQuery } from "@tanstack/react-query";
import { apiGet, type AuditLog } from "../api";
import { ErrorNote, formatTime } from "../components";

export function AuditPage() {
  const audit = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => apiGet<{ items: AuditLog[] }>("/admin/audit?limit=100"),
  });

  return (
    <section className="stack">
      <article className="card">
        <h2>Audit admin</h2>
        <p className="muted">100 aksi terakhir. Detail tidak memuat secret.</p>
        {audit.isPending ? <p className="muted">Memuat...</p> : null}
        <ErrorNote error={audit.error} />
        {audit.data ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Aktor</th>
                  <th>Aksi</th>
                  <th>Target</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((entry, index) => (
                  <tr key={`${entry.createdAt}-${index}`}>
                    <td>{formatTime(entry.createdAt)}</td>
                    <td>{entry.actorEmail}</td>
                    <td>{entry.action}</td>
                    <td>{entry.target ?? "-"}</td>
                    <td className="wrap">
                      <code>{entry.detail ?? "-"}</code>
                    </td>
                  </tr>
                ))}
                {audit.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Belum ada aksi admin.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>
    </section>
  );
}
