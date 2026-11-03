# Gapura

Backend gerbang pembayaran di Cloudflare Workers. Banyak project memakai satu akun merchant Duitku lewat Gapura; kredensial Duitku hanya ada di Gapura.

Spesifikasi produk: [PRD.md](PRD.md). Keputusan arsitektur: [docs/adr](docs/adr).

## Status

Fase 1-3 berjalan dan **staging live** di `https://pay.example.com` (D1 `gapura-sandbox`, Cron aktif, kredensial sandbox asli). Panel admin live di `https://admin.example.com` dan API `/admin/*` di `https://pay.example.com/admin/*`, dilindungi token admin (Bearer). Total 162 test. Kredensial sandbox asli sudah dipakai; pembayaran sandbox lewat demo Duitku berhasil dan callback asli membuat transaksi PAID.

## Struktur

```
apps/worker     Worker Hono + migrasi D1 (satu-satunya pemegang kredensial Duitku)
apps/panel      SPA React (Vite) untuk panel admin
packages/shared kode bersama: crypto, hmac, order id, status, skema Zod
```

## Prasyarat

- Node >= 22
- pnpm 12 (`corepack enable pnpm` bila belum ada)

## Setup

```sh
pnpm install
```

Variabel: lihat [.env.example](.env.example). Panel memakai `VITE_API_URL` di `apps/panel/.env.local`; Worker memakai `apps/worker/.dev.vars` untuk `wrangler dev` (di-.gitignore). `PUBLIC_BASE_URL` dan `DUITKU_BASE_URL` diatur di `apps/worker/wrangler.toml`.

## Jalankan

```sh
# API
pnpm --filter @gapura/worker db:migrate:local   # sekali, atau setelah migrasi baru
pnpm --filter @gapura/worker dev                # http://127.0.0.1:8787

# Panel (terminal lain)
pnpm --filter @gapura/panel dev                 # http://127.0.0.1:5173
```

## API

Semua endpoint `/v1/*` memakai header `X-Gapura-Key` (API key project). Error selalu `{"error":{"code":"...","message":"..."}}`.

| Endpoint | Fungsi |
|---|---|
| `GET /health` | status Worker, tanpa auth |
| `GET /v1/me` | identitas project pemilik API key |
| `POST /v1/payments` | buat transaksi Duitku, simpan `PENDING`, kembalikan `paymentUrl`/`vaNumber`/`qrString` |
| `GET /v1/payments/:orderId` | status transaksi milik project sendiri |
| `POST /callback/duitku` | callback Duitku; verifikasi HMAC-SHA256 + nominal, forward asinkron |
| `GET /admin/*`, `POST /admin/*`, `PATCH /admin/*` | panel admin; wajib `Authorization: Bearer <ADMIN_TOKEN>` |

Contoh:

```sh
curl -X POST http://127.0.0.1:8787/v1/payments \
  -H "X-Gapura-Key: <api-key-project>" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "INV123",
    "amount": 150000,
    "productDetails": "Paket Premium",
    "customerName": "Budi",
    "email": "budi@example.com",
    "paymentMethod": "VC",
    "returnUrl": "https://project-a.com/thanks"
  }'
```

`paymentMethod` adalah kode 2 karakter Duitku (`VC`, `VA`, `OV`, `DA`, ...). Order ID yang dikirim ke Duitku berbentuk `PREFIX-orderId` dan unik global.

## Panel admin

SPA React di `apps/panel` + endpoint `/admin/*` di Worker. Endpoint admin membandingkan token Bearer dengan secret `ADMIN_TOKEN` secara waktu-konstan; bila secret kosong endpoint menjawab `503 ADMIN_NOT_CONFIGURED` (fail closed). Panel meminta token sekali dan menyimpannya di `sessionStorage` tab; tombol Keluar menghapusnya.

```sh
pnpm --filter @gapura/panel dev   # http://127.0.0.1:5173
```

Halaman: Ringkasan (total PAID hari/bulan), Project (buat, edit nama/webhook URL, aktif/nonaktif, rotasi API key & webhook secret — kredensial tampil sekali; prefix tidak bisa diubah karena menempel di order ID Duitku), Transaksi (filter + detail + riwayat webhook), Webhook gagal (retry manual), dan Dokumentasi in-app (kontrak API + webhook + verifikasi signature + admin API). Setiap aksi admin dicatat di tabel `admin_audit` dengan email pelaku dari JWT.

Panel sudah dideploy di `https://admin.example.com` (Pages) dengan layar login token; alias `your-project.pages.dev` menampilkan login yang sama. API admin memakai Bearer `ADMIN_TOKEN`; request tanpa token ditolak 401. Langkah lengkap ada di `DEPLOYMENT.md`. Detail keputusan: [ADR-0007](docs/adr/0007-admin-memakai-token-bearer-tanpa-zero-trust.md).

## Referensi Duitku

Kontrak vendor dipelajari dan dicatat supaya tidak menebak:

- [docs/reference/duitku-api.md](docs/reference/duitku-api.md) — endpoint, signature HMAC, parameter inquiry/callback/cek transaksi, kode error, pemetaan ke Gapura.
- [docs/reference/duitku-payment-methods.md](docs/reference/duitku-payment-methods.md) — 32 channel per sistem, expiry, void, account link, channel aktif sandbox, batas nominal/order ID.
- Katalog machine-readable: `packages/shared/src/payment-methods.ts` (dipakai panel untuk label channel).

Batas yang ditegakkan Gapura: nominal minimal Rp10.000, `merchantOrderId` maks 50 karakter, email maks 50 karakter, `paymentMethod` 2 karakter.

## Webhook keluar

Saat status berubah, Gapura mengirim `POST` JSON ke `webhook_url` project:

```
X-Gapura-Event: payment.status
X-Gapura-Signature: t=<unix-seconds>,v1=<hex>
```

`v1 = HMAC_SHA256(<t> + "." + <body>, webhook_secret_project)`, body adalah byte JSON persis. Project wajib menolak timestamp di luar toleransi (disarankan 5 menit) dan memproses idempotent. Respons 2xx dianggap terkirim; selain itu dicatat di `webhook_logs` dengan jadwal retry (pemrosesnya menyusul di Fase 3).

Detail kontrak: [ADR-0004](docs/adr/0004-kontrak-integrasi-duitku-v2-dan-webhook-keluar.md).

## Retry dan sinkronisasi

Cron Trigger berjalan tiap menit (`[triggers]` di `wrangler.toml`) dan mengerjakan dua hal:

1. **Retry webhook** — baris `FAILED` yang `next_attempt_at`-nya lewat diklaim, dikirim ulang, lalu dicatat sebagai percobaan berikutnya. Jeda: 1m, 5m, 15m, 1j, 6j; percobaan ke-8 yang gagal menjadi `DEAD`. Pengiriman at-least-once — project wajib idempotent.
2. **Sinkronisasi pending** — transaksi `PENDING` lebih dari 10 menit dicek ke Duitku (`transactionStatus`): `00` → `PAID`, `02` → `EXPIRED`, `01` → tetap. Hanya perubahan yang diteruskan ke webhook.

Riwayat `DELIVERED`/`DEAD` lebih tua dari 30 hari dipangkas otomatis; `FAILED` yang masih terjadwal tidak disentuh.

Detail: [ADR-0005](docs/adr/0005-retry-webhook-dan-sinkronisasi-status-via-cron.md). Uji Cron lokal:

```sh
pnpm --filter @gapura/worker dev -- --test-scheduled
curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"
```

## Test dan verifikasi

```sh
pnpm verify
```

Menjalankan typecheck semua paket, test `packages/shared` dan `apps/worker`, build panel, dan bundel Worker (`wrangler deploy --dry-run`) tanpa mengunggah apa pun.

Test Worker memakai harness HTTP + repository in-memory untuk logika, SQL asli (`node:sqlite`) untuk repository/migrasi, dan klien Duitku palsu untuk jalur HTTP vendor. Alasan pilihan ini ada di [ADR-0003](docs/adr/0003-test-memakai-vitest-plus-sqlite-asli-bukan-minifla.md).

## Deploy

Staging sudah berjalan; langkah lengkap dan rollback ada di [DEPLOYMENT.md](DEPLOYMENT.md), triage di [RUNBOOK.md](RUNBOOK.md). Ringkas:

1. `wrangler d1 create gapura-sandbox`, isi `database_id` di `apps/worker/wrangler.toml`.
2. `wrangler d1 migrations apply gapura-sandbox --remote`.
3. `wrangler deploy`, lalu set `PUBLIC_BASE_URL` ke URL Worker dan deploy ulang.
4. `wrangler secret put DUITKU_MERCHANT_CODE` dan `DUITKU_API_KEY`.

Hanya layanan Cloudflare free tier yang dipakai (Workers, D1, Cron Trigger). Tanpa Queues/R2.

## Keamanan

Repo ini menangani transaksi pembayaran dan data pembeli (nama, email). Jangan commit secret Duitku, API key project, atau webhook secret. API key project disimpan sebagai hash SHA-256; key mentah hanya ditampilkan sekali saat dibuat (Fase 6). Laporan celah: [SECURITY.md](SECURITY.md). Ancaman dan checklist: [docs/SECURITY_CHECKLIST.md](docs/SECURITY_CHECKLIST.md). `pnpm audit` bersih per 2026-11-03.

## Bekerja dengan pakem

```sh
python3 .pakem/pakem.py start "<goal>"
python3 .pakem/pakem.py check
python3 .pakem/pakem.py finish --summary "<hasil + bukti>"
```

Routing konteks lengkap: [.pakem/CONTEXT.md](.pakem/CONTEXT.md).
