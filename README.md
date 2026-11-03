# Gapura

Backend gerbang pembayaran di Cloudflare Workers. Banyak project memakai satu akun merchant Duitku lewat Gapura; kredensial Duitku hanya ada di Gapura.

Spesifikasi produk: [PRD.md](PRD.md). Keputusan arsitektur: [docs/adr](docs/adr).

## Status

Fase 1 dan 2 berjalan lokal: Worker Hono dengan auth API key, create/cek payment, callback Duitku bertanda tangan, forward webhook bertanda tangan, skema D1, panel shell, dan 105 test. **Belum ada deploy** dan **belum ada transaksi ke sandbox Duitku sungguhan** (kredensial merchant belum tersedia). Retry otomatis (Cron) masuk Fase 3.

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

## Webhook keluar

Saat status berubah, Gapura mengirim `POST` JSON ke `webhook_url` project:

```
X-Gapura-Event: payment.status
X-Gapura-Signature: t=<unix-seconds>,v1=<hex>
```

`v1 = HMAC_SHA256(<t> + "." + <body>, webhook_secret_project)`, body adalah byte JSON persis. Project wajib menolak timestamp di luar toleransi (disarankan 5 menit) dan memproses idempotent. Respons 2xx dianggap terkirim; selain itu dicatat di `webhook_logs` dengan jadwal retry (pemrosesnya menyusul di Fase 3).

Detail kontrak: [ADR-0004](docs/adr/0004-kontrak-integrasi-duitku-v2-dan-webhook-keluar.md).

## Test dan verifikasi

```sh
pnpm verify
```

Menjalankan typecheck semua paket, test `packages/shared` dan `apps/worker`, build panel, dan bundel Worker (`wrangler deploy --dry-run`) tanpa mengunggah apa pun.

Test Worker memakai harness HTTP + repository in-memory untuk logika, SQL asli (`node:sqlite`) untuk repository/migrasi, dan klien Duitku palsu untuk jalur HTTP vendor. Alasan pilihan ini ada di [ADR-0003](docs/adr/0003-test-memakai-vitest-plus-sqlite-asli-bukan-minifla.md).

## Deploy

Belum dilakukan. Sebelum deploy pertama:

1. `wrangler d1 create gapura`, lalu ganti `database_id` placeholder di `apps/worker/wrangler.toml`.
2. `wrangler d1 migrations apply gapura --remote`.
3. `wrangler secret put DUITKU_MERCHANT_CODE` dan `DUITKU_API_KEY`.
4. Set `PUBLIC_BASE_URL` ke domain publik Worker (dipakai sebagai `callbackUrl` Duitku) dan sesuaikan `PANEL_ORIGIN`.

Hanya layanan Cloudflare free tier yang dipakai (Workers, D1, Cron Trigger). Tanpa Queues/R2.

## Keamanan

Repo ini menangani transaksi pembayaran dan data pembeli (nama, email). Jangan commit secret Duitku, API key project, atau webhook secret. API key project disimpan sebagai hash SHA-256; key mentah hanya ditampilkan sekali saat dibuat (Fase 6). Checklist keamanan ada di `.pakem/PROJECT.md`.

## Bekerja dengan pakem

```sh
python3 .pakem/pakem.py start "<goal>"
python3 .pakem/pakem.py check
python3 .pakem/pakem.py finish --summary "<hasil + bukti>"
```

Routing konteks lengkap: [.pakem/CONTEXT.md](.pakem/CONTEXT.md).
