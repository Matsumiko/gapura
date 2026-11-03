import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  apiGet,
  type PaymentStatus,
  type Project,
  type Transaction,
} from "../api";
import { ErrorNote, formatRupiah, formatTime } from "../components";

const PAGE_SIZE = 25;
const STATUSES: Array<PaymentStatus | ""> = ["", "PENDING", "PAID", "FAILED", "EXPIRED"];

export function TransactionsPage() {
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<PaymentStatus | "">("");
  const [offset, setOffset] = useState(0);

  const projects = useQuery({
    queryKey: ["admin", "projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/admin/projects"),
  });

  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));

  const transactions = useQuery({
    queryKey: ["admin", "transactions", projectId, status, offset],
    queryFn: () =>
      apiGet<{ items: Transaction[]; total: number }>(`/admin/transactions?${params}`),
  });

  return (
    <section className="stack">
      <article className="card">
        <h2>Filter</h2>
        <div className="filters">
          <label>
            Project
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">Semua</option>
              {projects.data?.items.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as PaymentStatus | "");
                setOffset(0);
              }}
            >
              {STATUSES.map((value) => (
                <option key={value || "all"} value={value}>
                  {value || "Semua"}
                </option>
              ))}
            </select>
          </label>
        </div>
      </article>

      <article className="card">
        <h2>Transaksi</h2>
        {transactions.isPending ? <p className="muted">Memuat...</p> : null}
        <ErrorNote error={transactions.error} />
        {transactions.data ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Project</th>
                    <th>Nominal</th>
                    <th>Metode</th>
                    <th>Status</th>
                    <th>Dibuat</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.data.items.map((item) => (
                    <tr key={item.merchantOrderId}>
                      <td>
                        <Link to={`/transactions/${item.merchantOrderId}`}>
                          {item.projectOrderId}
                        </Link>
                      </td>
                      <td>{item.projectName}</td>
                      <td>{formatRupiah(item.amount)}</td>
                      <td>{item.paymentMethod ?? "-"}</td>
                      <td>
                        <span className={`badge status-${item.status.toLowerCase()}`}>
                          {item.status}
                        </span>
                      </td>
                      <td>{formatTime(item.createdAt)}</td>
                    </tr>
                  ))}
                  {transactions.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        Tidak ada transaksi untuk filter ini.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <button
                type="button"
                className="ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Sebelumnya
              </button>
              <span className="muted">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, transactions.data.total)} dari{" "}
                {transactions.data.total}
              </span>
              <button
                type="button"
                className="ghost"
                disabled={offset + PAGE_SIZE >= transactions.data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Berikutnya
              </button>
            </div>
          </>
        ) : null}
      </article>
    </section>
  );
}
