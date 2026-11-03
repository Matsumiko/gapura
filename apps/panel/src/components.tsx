import { ApiError } from "./api";

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
