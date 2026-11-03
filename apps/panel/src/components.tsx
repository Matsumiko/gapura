import { ApiError } from "./api";

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) {
    return null;
  }
  const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
  const status = error instanceof ApiError ? error.status : null;

  return (
    <div className="error" role="alert">
      <strong>Gagal memuat.</strong> {message}
      {status === 401 || status === 503 ? (
        <span className="muted">
          {" "}
          Akses admin belum aktif di environment ini (Cloudflare Access / ACCESS_AUD).
        </span>
      ) : null}
    </div>
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
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}
