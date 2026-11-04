import { createContext, useContext, type ReactNode } from "react";
import { ApiError, type ApiEnvironment } from "./api";

const EnvironmentContext = createContext<ApiEnvironment>("sandbox");

export function EnvironmentProvider({
  value,
  children,
}: {
  value: ApiEnvironment;
  children: ReactNode;
}) {
  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
}

export function useEnvironment(): ApiEnvironment {
  return useContext(EnvironmentContext);
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) {
    return null;
  }
  const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
  const status = error instanceof ApiError ? error.status : null;
  const code = error instanceof ApiError ? error.code : null;
  const credentialError = code === "INVALID_CREDENTIALS" || code === "INVALID_SETUP_TOKEN";

  return (
    <div className="error" role="alert">
      <strong>Gagal.</strong> {message}
      {status === 401 && !credentialError ? (
        <span className="muted"> Sesi admin berakhir. Silakan masuk lagi.</span>
      ) : null}
      {status === 403 && code === "FORBIDDEN" ? (
        <span className="muted"> Role viewer tidak boleh mengubah data.</span>
      ) : null}
      {status === 403 && code === "CSRF_INVALID" ? (
        <span className="muted"> CSRF token tidak valid. Muat ulang halaman lalu masuk lagi.</span>
      ) : null}
      {status === 503 ? (
        <span className="muted"> Auth admin belum dikonfigurasi di Worker.</span>
      ) : null}
    </div>
  );
}

export function PageHeader({ title, lede }: { title: string; lede?: ReactNode }) {
  const environment = useEnvironment();
  return (
    <header className="page-head">
      <div className="page-head__text">
        <div className="page-head__title-row">
          <h1>{title}</h1>
          <span className="page-env" data-env={environment}>
            <span className="visually-hidden">Environment </span>
            {environment}
          </span>
        </div>
        {lede ? <p className="page-lede">{lede}</p> : null}
      </div>
    </header>
  );
}

export function formatStatus(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge status-${status.toLowerCase()}`} data-status={status}>
      {formatStatus(status)}
    </span>
  );
}

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-skeleton" role="status" aria-live="polite">
      <span className="visually-hidden">Memuat…</span>
      {Array.from({ length: rows }).map((_, row) => (
        <div className="table-skeleton__row" key={row} aria-hidden="true">
          {Array.from({ length: cols }).map((__, col) => (
            <span className="table-skeleton__cell" key={col} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="table-empty">
        {children}
      </td>
    </tr>
  );
}

export function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
