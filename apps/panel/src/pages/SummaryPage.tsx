import { useQuery } from "@tanstack/react-query";
import { apiGet, type Summary } from "../api";
import { ErrorNote, PageHeader, TableSkeleton, formatRupiah } from "../components";

export function SummaryPage() {
  const summary = useQuery({
    queryKey: ["admin", "summary"],
    queryFn: () => apiGet<Summary>("/admin/summary"),
  });

  if (summary.isPending) {
    return (
      <>
        <PageHeader
          title="Ringkasan"
          lede="Transaksi PAID hari ini dan bulan ini, dihitung per project."
        />
        <div className="panel">
          <TableSkeleton rows={4} cols={3} />
        </div>
      </>
    );
  }
  if (summary.isError) {
    return (
      <>
        <PageHeader
          title="Ringkasan"
          lede="Transaksi PAID hari ini dan bulan ini, dihitung per project."
        />
        <div className="panel">
          <ErrorNote error={summary.error} />
        </div>
      </>
    );
  }

  const data = summary.data;
  return (
    <>
      <PageHeader
        title="Ringkasan"
        lede="Transaksi PAID hari ini dan bulan ini, dihitung per project."
      />

      <section className="ledger" aria-label="Ringkasan transaksi PAID">
        <div className="ledger__primary">
          <h2>Hari ini</h2>
          <p className="reading num">{formatRupiah(data.today.amount)}</p>
          <p className="ledger__meta">
            <span className="num">{data.today.count}</span> transaksi PAID
          </p>
        </div>
        <div className="ledger__aside">
          <div>
            <h2>Bulan ini</h2>
            <p className="metric__value num">{formatRupiah(data.month.amount)}</p>
            <p className="ledger__meta">
              <span className="num">{data.month.count}</span> transaksi PAID
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Per project</h2>
        </div>
        {data.projects.length === 0 ? (
          <p className="empty-note">Belum ada project. Tambahkan lewat halaman Project.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col" className="cell-num">Hari ini</th>
                  <th scope="col" className="cell-num">Bulan ini</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((row) => (
                  <tr key={row.projectId}>
                    <td className="table__name" data-label="Project">{row.projectName}</td>
                    <td className="cell-num" data-label="Hari ini">
                      <span className="table__amount num">{formatRupiah(row.todayAmount)}</span>
                      <span className="table__sub num">{row.todayCount} transaksi</span>
                    </td>
                    <td className="cell-num" data-label="Bulan ini">
                      <span className="table__amount num">{formatRupiah(row.monthAmount)}</span>
                      <span className="table__sub num">{row.monthCount} transaksi</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
