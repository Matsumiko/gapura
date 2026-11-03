# MODULE-MAP

<!-- Perbarui setiap menambah, memindah, atau menghapus modul. Path ditulis dalam backtick dan
diperiksa oleh gate drift: path yang tidak ada di repo membuat check/finish gagal.
Tambahkan komentar pakem:ignore di baris yang sengaja menyebut path hipotetis. -->

## Struktur

Worker (Cloudflare):
- `apps/worker/src/index.ts` — entry point: membangun runtime `/sandbox` (DB_SANDBOX) dan `/production` (DB_PRODUCTION), mount route, jalankan Cron keduanya, merangkai repository, provider, service, dan `ctx.waitUntil`. Tanpa logika bisnis.
- `apps/worker/src/app.ts` — merangkai Hono: CORS panel, `/health`, `/v1/*` dengan auth, callback Duitku, 404/500.
- `apps/worker/src/middleware/auth.ts` — membaca `X-Gapura-Key`, mencocokkan hash, menolak project nonaktif.
- `apps/worker/src/routes/payments.ts` — `POST /v1/payments` dan `GET /v1/payments/:orderId`, menerjemahkan error domain ke status HTTP.
- `apps/worker/src/routes/payment-methods.ts` — `GET /v1/payment-methods`: validasi nominal, ambil channel aktif dari provider, petakan error.
- `apps/worker/src/routes/callback.ts` — `POST /callback/duitku`: parse form, verifikasi lewat service, jadwalkan forward asinkron.
- `apps/worker/src/routes/admin.ts` — endpoint `/admin/*`: ringkasan, project, transaksi, webhook retry; menerjemahkan error domain ke HTTP.
- `apps/worker/src/middleware/admin-auth.ts` — wajib Bearer `ADMIN_TOKEN` (waktu-konstan); fail closed bila secret kosong.
- `apps/worker/src/repositories/admin.ts` — SQL khusus admin: daftar/mutasi project (termasuk edit profil), daftar transaksi + filter, riwayat webhook, ringkasan, audit.
- `apps/worker/src/services/admin.ts` — operasi admin (buat project, rotasi kredensial, ringkasan, retry webhook) + penulisan audit.
- `apps/worker/src/services/payment-methods.ts` — membungkus channel aktif + menggabungkan katalog (nama resmi, sistem).
- `apps/worker/src/services/payments.ts` — orkestrasi buat transaksi: order ID, simpan PENDING, panggil provider, simpan artefak; membuang baris PENDING bila vendor gagal sebelum transaksi dibuat.
- `apps/worker/src/services/callbacks.ts` — verifikasi signature/nominal/merchant, transisi status hanya sekali, menyusun payload forward.
- `apps/worker/src/services/webhooks.ts` — satu percobaan kirim bertanda tangan HMAC + timestamp; forwarder mencatat percobaan pertama dan menjadwalkan retry.
- `apps/worker/src/services/payload.ts` — bentuk payload webhook (`paymentPayload`) yang dipakai forwarder, retry, dan sync.
- `apps/worker/src/services/retry-policy.ts` — batas 8 percobaan dan jeda 1m/5m/15m/1j/6j.
- `apps/worker/src/services/retries.ts` — pemroses retry: ambil jatuh tempo, klaim lease, kirim, catat percobaan berikutnya, tandai DEAD.
- `apps/worker/src/services/sync.ts` — sinkronisasi transaksi PENDING lama via `transactionStatus` Duitku; hanya transisi yang berubah diteruskan.
- `apps/worker/src/services/credentials.ts` — cipher AES-GCM untuk API key.
- `apps/worker/src/services/totp.ts` — TOTP RFC 6238 + base32.
- `apps/worker/src/services/admin-password.ts` — hash/verify Argon2id.
- `apps/worker/src/services/credential-resolver.ts` — kredensial aktif dari D1 atau fallback secret Worker.
- `apps/worker/src/services/settings.ts` — simpan/aktifkan/uji kredensial + audit.
- `apps/worker/src/providers/managed.ts` — provider dinamis mengikuti environment dan versi kredensial.
- `apps/worker/src/routes/settings.ts` — endpoint `/admin/settings`.
- `apps/worker/src/services/retention.ts` — memangkas riwayat `webhook_logs` selesai yang lebih tua dari 30 hari.
- `apps/worker/src/cron.ts` — urutan Cron: retry lalu sinkronisasi, mengembalikan ringkasan.
- `apps/worker/src/index.ts` — juga mengekspor handler `scheduled` yang menjalankan Cron.
- `apps/worker/src/providers/duitku.ts` — klien Duitku API v2: formula signature, inquiry, cek status, getPaymentMethod dengan cache, pemetaan respons, error ber-kode.
- `apps/worker/src/repositories/projects.ts` — query D1 untuk auth project.
- `apps/worker/src/repositories/transactions.ts` — satu-satunya tempat SQL transaksi; update status bersyarat `WHERE status = 'PENDING'`.
- `apps/worker/src/repositories/webhook-logs.ts` — mencatat percobaan forward.
- `apps/worker/src/repositories/settings.ts` — kredensial Duitku per environment (enkripsi AES-GCM).
- `apps/worker/src/http.ts` — bentuk error JSON yang seragam.
- `apps/worker/src/types.ts` — Env, record domain, interface repository/service.
- `apps/worker/migrations/0001_init.sql` — skema D1: projects, transactions, webhook_logs + index.
- `apps/worker/migrations/0002_payment_artifacts.sql` — kolom `va_number` dan `qr_string`.
- `apps/worker/migrations/0003_admin_audit.sql` — tabel `admin_audit` untuk jejak aksi admin.
- `apps/worker/migrations/0004_merchant_settings.sql` — kredensial per environment.
- `apps/worker/migrations/0005_admin_auth.sql` — admin_users, admin_sessions, admin_login_attempts (auth baru, belum aktif).

Shared (dipakai Worker dan panel):
- `packages/shared/src/crypto.ts` — sha256Hex, generator API key dan webhook secret.
- `packages/shared/src/hmac.ts` — hmacSha256Hex dan secureEqual untuk signature Duitku dan webhook keluar.
- `packages/shared/src/order.ts` — build/parse merchant order id (`PREFIX-orderId`).
- `packages/shared/src/status.ts` — daftar status dan aturan transisi hanya maju.
- `packages/shared/src/payment.ts` — skema Zod body create payment (kode metode 2 karakter, nominal ≥ Rp10.000).
- `packages/shared/src/payment-methods.ts` — katalog 32 channel Duitku (sistem, kode, expiry, void, account link) untuk label panel dan referensi.
- `packages/shared/src/index.ts` — re-export; Worker mengimpor subpath agar Zod hanya masuk bundle saat dipakai.

Panel:
- `apps/panel/src/main.tsx` — bootstrap React + QueryClient.
- `apps/panel/src/App.tsx` — halaman status API.
- `apps/panel/src/api.ts` — base URL `VITE_API_URL`, tipe admin, token di sessionStorage, fetch dengan header Authorization.
- `apps/panel/src/App.tsx` — gate login token + layout React Router.
- `apps/panel/src/pages/LoginPage.tsx` — layar token admin (verifikasi lewat `/admin/summary`).
- `apps/panel/src/pages/SummaryPage.tsx` — total PAID hari/bulan per project.
- `apps/panel/src/pages/ProjectsPage.tsx` — buat project, edit nama/webhook (prefix tetap), aktif/nonaktif, rotasi key/secret (tampil sekali).
- `apps/panel/src/pages/TransactionsPage.tsx` — daftar transaksi dengan filter dan paging.
- `apps/panel/src/pages/TransactionDetailPage.tsx` — detail transaksi + riwayat webhook + retry.
- `apps/panel/src/pages/WebhooksPage.tsx` — antrean FAILED/DEAD dan kirim ulang.
- `apps/panel/src/pages/SettingsPage.tsx` — kelola merchant key sandbox/production, aktivasi, uji.
- `apps/panel/src/pages/AuditPage.tsx` — jejak aksi admin.
- `apps/panel/src/pages/DocsPage.tsx` — dokumentasi in-app: integrasi project, katalog metode pembayaran, API, webhook + verifikasi signature, status, error, admin API, troubleshooting.

Test:
- `apps/worker/test/app.test.ts` — auth, CORS, routing lewat `app.request`.
- `apps/worker/test/payments.test.ts` — create/get payment, duplikat, provider gagal, validasi body.
- `apps/worker/test/callbacks.test.ts` — signature, nominal, idempotensi callback, forwarding.
- `apps/worker/test/webhooks.test.ts` — format signature, log sukses/gagal/retry.
- `apps/worker/test/duitku.test.ts` — vektor signature independen, body inquiry, getPaymentMethod + cache, pemetaan error.
- `apps/worker/test/payment-methods.test.ts` — validasi nominal, pemetaan katalog, error provider.
- `apps/worker/test/transactions-repository.test.ts` — SQL asli di SQLite (status, referensi, join, query pending lama).
- `apps/worker/test/webhook-logs-repository.test.ts` — pemilihan jatuh tempo, klaim, clear, dead.
- `apps/worker/test/retry-policy.test.ts` — urutan backoff dan batas percobaan.
- `apps/worker/test/retries.test.ts` — klaim, pengiriman ulang, backoff, DEAD.
- `apps/worker/test/sync.test.ts` — pemetaan 00/01/02, transaksi lama vs baru, kegagalan provider.
- `apps/worker/test/totp.test.ts` — vektor RFC dan replay.
- `apps/worker/test/admin-password.test.ts` — Argon2id PHC.
- `apps/worker/test/settings.test.ts` — cipher, simpan/aktifkan/uji kredensial, audit.
- `apps/worker/test/settings-routes.test.ts` — otorisasi dan endpoint pengaturan.
- `apps/worker/test/managed-provider.test.ts` — pemilihan environment dan rotasi kredensial.
- `apps/worker/test/retention.test.ts` — pemangkasan hanya untuk baris terminal lama.
- `apps/worker/test/admin.test.ts` — otorisasi token, CRUD project, rotasi kredensial, ringkasan, filter transaksi, retry webhook, audit.
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

Menambah endpoint admin: taruh operasi di `apps/worker/src/services/admin.ts`, SQL di `apps/worker/src/repositories/admin.ts`, validasi Zod di `packages/shared/src/admin.ts`, dan pastikan setiap mutasi menulis audit.

Menambah pekerjaan periodik: letakkan logika di `apps/worker/src/services/`, panggil dari `apps/worker/src/cron.ts`, dan pastikan idempotent karena Cron bisa tumpang tindih; klaim baris dengan update bersyarat, jangan asumsikan satu eksekusi.

Menambah provider pembayaran: implementasikan `PaymentProvider` di `apps/worker/src/providers/`, jangan menaruh HTTP vendor di service; mapping status vendor ke PENDING, PAID, FAILED, atau EXPIRED tetap di provider atau service terkait.

## Arah dependensi

HTTP: `apps/worker/src/index.ts` → `apps/worker/src/app.ts` → `apps/worker/src/routes/` → `apps/worker/src/services/` → `apps/worker/src/repositories/` dan `apps/worker/src/providers/` → `apps/worker/src/types.ts`.
Cron: `apps/worker/src/index.ts` (scheduled) → `apps/worker/src/cron.ts` → `apps/worker/src/services/retries.ts` + `apps/worker/src/services/sync.ts` → repository/provider. D1 hanya di `apps/worker/src/repositories/`; HTTP vendor hanya di `apps/worker/src/providers/`.
`packages/shared` tidak boleh mengimpor dari `apps/*`. Panel hanya memakai HTTP API, bukan impor kode Worker.
Tidak ada impor melingkar; modul yang butuh data dari modul lain menerima parameter (repository/provider/fetch/clock), bukan mengimpor singleton.
