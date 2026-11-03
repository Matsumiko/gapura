import { useQuery } from "@tanstack/react-query";
import { apiGet, type Summary } from "../api";
import { ErrorNote, formatRupiah } from "../components";

export function SummaryPage() {
  const summary = useQuery({
    queryKey: ["admin", "summary"],
    queryFn: () => apiGet<Summary>("/admin/summary"),
  });

  if (summary.isPending) {
    return <p className="muted">Memuat ringkasan...</p>;
  }
  if (summary.isError) {
    return <ErrorNote error={summary.error} />;
  }

  const data = summary.data;
  return (
    <section className="stack">
      <div className="cards">
        <article className="card">
          <h2>Hari ini</h2>
          <p className="big">{formatRupiah(data.today.amount)}</p>
          <p className="muted">{data.today.count} transaksi PAID</p>
        </article>
        <article className="card">
          <h2>Bulan ini</h2>
          <p className="big">{formatRupiah(data.month.amount)}</p>
          <p className="muted">{data.month.count} transaksi PAID</p>
        </article>
      </div>

      <article className="card">
        <h2>Per project</h2>
        {data.projects.length === 0 ? (
          <p className="muted">Belum ada project. Tambahkan lewat halaman Project.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Hari ini</th>
                  <th>Bulan ini</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((row) => (
                  <tr key={row.projectId}>
                    <td>{row.projectName}</td>
                    <td>
                      {formatRupiah(row.todayAmount)}{" "}
                      <span className="muted">({row.todayCount})</span>
                    </td>
                    <td>
                      {formatRupiah(row.monthAmount)}{" "}
                      <span className="muted">({row.monthCount})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
