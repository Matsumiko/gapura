# MODULE-MAP

<!-- Perbarui setiap menambah, memindah, atau menghapus modul. Path ditulis dalam backtick dan
diperiksa oleh gate drift: path yang tidak ada di repo membuat check/finish gagal.
Tambahkan komentar pakem:ignore di baris yang sengaja menyebut path hipotetis. -->

## Struktur

Worker (Cloudflare):
- `apps/worker/src/index.ts` — entry point: cache app per binding Env, merangkai repository, provider, service, dan `ctx.waitUntil`. Tanpa logika bisnis.
- `apps/worker/src/app.ts` — merangkai Hono: CORS panel, `/health`, `/v1/*` dengan auth, callback Duitku, 404/500.
- `apps/worker/src/middleware/auth.ts` — membaca `X-Gapura-Key`, mencocokkan hash, menolak project nonaktif.
- `apps/worker/src/routes/payments.ts` — `POST /v1/payments` dan `GET /v1/payments/:orderId`, menerjemahkan error domain ke status HTTP.
- `apps/worker/src/routes/callback.ts` — `POST /callback/duitku`: parse form, verifikasi lewat service, jadwalkan forward asinkron.
- `apps/worker/src/services/payments.ts` — orkestrasi buat transaksi: order ID, simpan PENDING, panggil provider, simpan artefak; membuang baris PENDING bila vendor gagal sebelum transaksi dibuat.
- `apps/worker/src/services/callbacks.ts` — verifikasi signature/nominal/merchant, transisi status hanya sekali, menyusun payload forward.
- `apps/worker/src/services/webhooks.ts` — forward bertanda tangan HMAC + timestamp, catat hasil ke `webhook_logs`, jadwalkan retry pertama.
- `apps/worker/src/providers/duitku.ts` — klien Duitku API v2: formula signature, inquiry, pemetaan respons, error ber-kode.
- `apps/worker/src/repositories/projects.ts` — query D1 untuk auth project.
- `apps/worker/src/repositories/transactions.ts` — satu-satunya tempat SQL transaksi; update status bersyarat `WHERE status = 'PENDING'`.
- `apps/worker/src/repositories/webhook-logs.ts` — mencatat percobaan forward.
- `apps/worker/src/http.ts` — bentuk error JSON yang seragam.
- `apps/worker/src/types.ts` — Env, record domain, interface repository/service.
- `apps/worker/migrations/0001_init.sql` — skema D1: projects, transactions, webhook_logs + index.
- `apps/worker/migrations/0002_payment_artifacts.sql` — kolom `va_number` dan `qr_string`.

Shared (dipakai Worker dan panel):
- `packages/shared/src/crypto.ts` — sha256Hex, generator API key dan webhook secret.
- `packages/shared/src/hmac.ts` — hmacSha256Hex dan secureEqual untuk signature Duitku dan webhook keluar.
- `packages/shared/src/order.ts` — build/parse merchant order id (`PREFIX-orderId`).
- `packages/shared/src/status.ts` — daftar status dan aturan transisi hanya maju.
- `packages/shared/src/payment.ts` — skema Zod body create payment (termasuk kode metode 2 karakter).
- `packages/shared/src/index.ts` — re-export; Worker mengimpor subpath agar Zod hanya masuk bundle saat dipakai.

Panel:
- `apps/panel/src/main.tsx` — bootstrap React + QueryClient.
- `apps/panel/src/App.tsx` — halaman status API.
- `apps/panel/src/api.ts` — base URL dari `VITE_API_URL` dan fetch health.

Test:
- `apps/worker/test/app.test.ts` — auth, CORS, routing lewat `app.request`.
- `apps/worker/test/payments.test.ts` — create/get payment, duplikat, provider gagal, validasi body.
- `apps/worker/test/callbacks.test.ts` — signature, nominal, idempotensi callback, forwarding.
- `apps/worker/test/webhooks.test.ts` — format signature, log sukses/gagal/retry.
- `apps/worker/test/duitku.test.ts` — vektor signature independen, body inquiry, pemetaan error.
- `apps/worker/test/transactions-repository.test.ts` — SQL asli di SQLite (status, referensi, join).
- `apps/worker/test/schema.test.ts` — constraint dan index migrasi.
- `apps/worker/test/support/` — harness HTTP, repository in-memory, adapter D1→SQLite. Bukan test.
- `packages/shared/test/` — unit test crypto, hmac, order id, status, dan skema payment.

## Pola yang dipakai

Menambah endpoint Worker:
1. Validasi input dengan skema di `packages/shared` (atau skema baru di sana bila dipakai panel juga).
2. Query D1 hanya lewat repository di `apps/worker/src/repositories/`; repository menerima `D1Database` dan mengembalikan objek domain, bukan baris mentah.
3. Logika lintas repository/provider masuk `apps/worker/src/services/`; route hanya memetakan HTTP.
4. Daftarkan route di `apps/worker/src/routes/`, sambungkan di `apps/worker/src/app.ts`.
5. Tambah test di `apps/worker/test/` memakai harness (`apps/worker/test/support/harness.ts`) atau SQL asli untuk repository.

Menambah tabel/kolom: buat file migrasi baru bernomor di `apps/worker/migrations/`, jangan mengedit yang sudah ada; tambah test constraint di `apps/worker/test/schema.test.ts`; perbarui PRD bagian 7.

Menambah provider pembayaran: implementasikan `PaymentProvider` di `apps/worker/src/providers/`, jangan menaruh HTTP vendor di service; mapping status vendor ke PENDING, PAID, FAILED, atau EXPIRED tetap di provider atau service terkait.

## Arah dependensi

`apps/worker/src/index.ts` → `apps/worker/src/app.ts` → `apps/worker/src/routes/` → `apps/worker/src/services/` → `apps/worker/src/repositories/` dan `apps/worker/src/providers/` → `apps/worker/src/types.ts`. D1 hanya di `apps/worker/src/repositories/`; HTTP vendor hanya di `apps/worker/src/providers/`.
`packages/shared` tidak boleh mengimpor dari `apps/*`. Panel hanya memakai HTTP API, bukan impor kode Worker.
Tidak ada impor melingkar; modul yang butuh data dari modul lain menerima parameter (repository/provider/fetch/clock), bukan mengimpor singleton.
