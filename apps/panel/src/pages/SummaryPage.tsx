import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  apiGet,
  type Summary,
  type Transaction,
  type WebhookLog,
} from "../api";
import { ErrorNote, PageHeader, TableSkeleton, formatRupiah, formatTime } from "../components";

export function SummaryPage() {
  const summary = useQuery({
    queryKey: ["admin", "summary"],
    queryFn: () => apiGet<Summary>("/admin/summary"),
  });
  const recent = useQuery({
    queryKey: ["admin", "dashboard", "recent"],
    queryFn: () => apiGet<{ items: Transaction[]; total: number }>("/admin/transactions?limit=6"),
  });
  const pending = useQuery({
    queryKey: ["admin", "dashboard", "pending"],
    queryFn: () =>
      apiGet<{ items: Transaction[]; total: number }>("/admin/transactions?status=PENDING&limit=1"),
  });
  const failed = useQuery({
    queryKey: ["admin", "dashboard", "failed"],
    queryFn: () => apiGet<{ items: WebhookLog[] }>("/admin/webhooks?status=FAILED&limit=5"),
  });

  if (summary.isPending) {
    return (
      <>
        <PageHeader title="Dashboard" lede="Uang masuk, transaksi terbaru, dan antrean webhook." />
        <div className="panel">
          <TableSkeleton rows={4} cols={4} />
        </div>
      </>
    );
  }
  if (summary.isError) {
    return (
      <>
        <PageHeader title="Dashboard" lede="Uang masuk, transaksi terbaru, dan antrean webhook." />
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
        title="Dashboard"
        lede="Uang masuk, transaksi terbaru, dan antrean webhook untuk environment ini."
      />

      <section className="band" aria-label="Indikator utama">
        <div className="band__lead">
          <p className="band__label">Pendapatan hari ini</p>
          <p className="band__value num">{formatRupiah(data.today.amount)}</p>
          <p className="band__meta">
            <span className="num">{data.today.count}</span> transaksi PAID
          </p>
        </div>
        <dl className="band__side">
          <div>
            <dt>Bulan ini</dt>
            <dd className="num">{formatRupiah(data.month.amount)}</dd>
            <dd className="band__sub">
              <span className="num">{data.month.count}</span> transaksi PAID
            </dd>
          </div>
          <div>
            <dt>Menunggu pembayaran</dt>
            <dd className="num">{pending.data?.total ?? "–"}</dd>
            <dd className="band__sub">transaksi PENDING</dd>
          </div>
          <div>
            <dt>Webhook gagal</dt>
            <dd className="num">{failed.data?.items.length ?? "–"}</dd>
            <dd className="band__sub">menunggu retry</dd>
          </div>
        </dl>
      </section>

      <div className="dash-grid">
        <section className="panel dash-span">
          <div className="panel-head">
            <h2>Transaksi terbaru</h2>
            <Link className="text-link" to="/transactions">
              Lihat semua
            </Link>
          </div>
          {recent.isPending ? <TableSkeleton rows={5} cols={5} /> : null}
          <ErrorNote error={recent.error} />
          {recent.data ? (
            recent.data.items.length === 0 ? (
              <p className="empty-note">Belum ada transaksi.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Project</th>
                      <th scope="col" className="cell-num">Nominal</th>
                      <th scope="col">Status</th>
                      <th scope="col">Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.data.items.map((item) => (
                      <tr key={item.merchantOrderId}>
                        <td className="table__name" data-label="Order">
                          <Link to={`/transactions/${item.merchantOrderId}`}>
                            {item.projectOrderId}
                          </Link>
                        </td>
                        <td data-label="Project">{item.projectName}</td>
                        <td className="cell-num" data-label="Nominal">
                          <span className="table__amount num">{formatRupiah(item.amount)}</span>
                        </td>
                        <td data-label="Status">
                          <span className="badge" data-status={item.status}>
                            {item.status.toLowerCase()}
                          </span>
                        </td>
                        <td className="cell-time" data-label="Waktu">
                          {formatTime(item.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Antrean webhook</h2>
            <Link className="text-link" to="/webhooks">
              Buka antrean
            </Link>
          </div>
          {failed.isPending ? <TableSkeleton rows={4} cols={2} /> : null}
          <ErrorNote error={failed.error} />
          {failed.data ? (
            failed.data.items.length === 0 ? (
              <p className="empty-note">Tidak ada webhook menunggu retry.</p>
            ) : (
              <ul className="queue">
                {failed.data.items.map((item) => (
                  <li key={item.id} className="queue__item">
                    <span className="queue__name">{item.merchantOrderId}</span>
                    <span className="queue__meta">
                      {item.projectName} · percobaan <span className="num">{item.attempt}</span>
                    </span>
                    <span className="queue__meta">{item.error ?? "menunggu jadwal"}</span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
      </div>

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
                    <td className="table__name" data-label="Project">
                      {row.projectName}
                    </td>
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
