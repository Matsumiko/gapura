# MODULE-MAP

<!-- Perbarui setiap menambah, memindah, atau menghapus modul. Path ditulis dalam backtick dan
diperiksa oleh gate drift: path yang tidak ada di repo membuat check/finish gagal.
Tambahkan komentar pakem:ignore di baris yang sengaja menyebut path hipotetis. -->

## Struktur

Worker (Cloudflare):
- `apps/worker/src/index.ts` — entry point: cache app per binding Env, meneruskan request. Tanpa logika bisnis.
- `apps/worker/src/app.ts` — merangkai Hono: CORS panel, `/health`, `/v1/*` dengan auth, handler 404/500.
- `apps/worker/src/middleware/auth.ts` — membaca `X-Gapura-Key`, mencocokkan hash, menolak project nonaktif.
- `apps/worker/src/repositories/projects.ts` — satu-satunya tempat query D1 untuk tabel projects.
- `apps/worker/src/http.ts` — bentuk error JSON yang seragam.
- `apps/worker/src/types.ts` — Env, ProjectRecord, ProjectRepository, AppEnv.
- `apps/worker/migrations/0001_init.sql` — skema D1: projects, transactions, webhook_logs + index.

Shared (dipakai Worker dan panel):
- `packages/shared/src/crypto.ts` — sha256Hex, generator API key dan webhook secret.
- `packages/shared/src/order.ts` — build/parse merchant order id (`PREFIX-orderId`).
- `packages/shared/src/status.ts` — daftar status dan aturan transisi hanya maju.
- `packages/shared/src/payment.ts` — skema Zod body create payment.
- `packages/shared/src/index.ts` — re-export; jangan diimpor Worker (menarik Zod ke bundle).

Panel:
- `apps/panel/src/main.tsx` — bootstrap React + QueryClient.
- `apps/panel/src/App.tsx` — halaman status API.
- `apps/panel/src/api.ts` — base URL dari `VITE_API_URL` dan fetch health.

Test:
- `apps/worker/test/app.test.ts` — auth, CORS, routing lewat `app.request` dengan repository palsu.
- `apps/worker/test/schema.test.ts` — migrasi dijalankan di SQLite asli, cek constraint dan index.
- `packages/shared/test/` — unit test crypto, order id, status, dan skema payment.

## Pola yang dipakai

Menambah endpoint Worker:
1. Validasi input dengan skema di `packages/shared` (atau skema baru di sana bila dipakai panel juga).
2. Query D1 hanya lewat repository baru di `apps/worker/src/repositories/`; repository menerima `D1Database` dan mengembalikan objek domain, bukan baris mentah.
3. Daftarkan route di `apps/worker/src/app.ts`; jangan menaruh SQL di handler.
4. Tambah test di `apps/worker/test/` memakai `buildApp` + repository palsu untuk logika, dan test migrasi bila skema berubah.

Menambah tabel/kolom: buat file migrasi baru bernomor di `apps/worker/migrations/`, jangan mengedit migrasi yang sudah ada; tambah test constraint di `apps/worker/test/schema.test.ts`; perbarui PRD bagian 7.

## Arah dependensi

`apps/worker/src/index.ts` → `apps/worker/src/app.ts` → `apps/worker/src/middleware/` dan `apps/worker/src/repositories/` → `apps/worker/src/types.ts`. D1 hanya di `apps/worker/src/repositories/`.
`packages/shared` tidak boleh mengimpor dari `apps/*`. Panel hanya memakai HTTP API, bukan impor kode Worker.
Tidak ada impor melingkar; modul yang butuh data dari modul lain menerima parameter, bukan mengimpor singleton.
