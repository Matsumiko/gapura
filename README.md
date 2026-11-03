# Gapura

Backend gerbang pembayaran di Cloudflare Workers. Banyak project memakai satu akun merchant Duitku lewat Gapura; kredensial Duitku hanya ada di Gapura.

Spesifikasi produk: [PRD.md](PRD.md). Keputusan arsitektur: [docs/adr](docs/adr).

## Status

Fase 1 (fondasi) berjalan lokal: Worker Hono dengan `/health` dan `/v1/me`, autentikasi API key lewat D1, skema tiga tabel, panel shell React, dan test. **Belum ada deploy**, belum ada transaksi Duitku, callback, retry, atau panel fungsional. Deploy staging menunggu akun Cloudflare dan `database_id` D1 asli.

## Struktur

```
apps/worker     Worker Hono + migrasi D1 (satu-satunya pemegang kredensial Duitku)
apps/panel      SPA React (Vite) untuk panel admin
packages/shared kode bersama: crypto, order id, status, skema Zod
```

## Prasyarat

- Node >= 22
- pnpm 12 (`corepack enable pnpm` bila belum ada)

## Setup

```sh
pnpm install
```

Variabel: lihat [.env.example](.env.example). Panel memakai `VITE_API_URL` di `apps/panel/.env.local`; Worker memakai `apps/worker/.dev.vars` untuk `wrangler dev` (file ini di-.gitignore).

## Jalankan

```sh
# API
pnpm --filter @gapura/worker db:migrate:local   # sekali, atau setelah migrasi baru
pnpm --filter @gapura/worker dev                # http://127.0.0.1:8787

# Panel (terminal lain)
pnpm --filter @gapura/panel dev                 # http://127.0.0.1:5173
```

Contoh memanggil API dengan project yang sudah diseed di D1 lokal:

```sh
curl -H "X-Gapura-Key: <api-key-project>" http://127.0.0.1:8787/v1/me
```

## Test dan verifikasi

```sh
pnpm verify
```

Menjalankan typecheck semua paket, test `packages/shared` dan `apps/worker`, build panel, dan bundel Worker (`wrangler deploy --dry-run`) tanpa mengunggah apa pun.

Test Worker memakai `buildApp` + repository palsu untuk auth/CORS/routing, dan `node:sqlite` untuk menjalankan migrasi di SQLite asli (constraint, index). Alasan pilihan ini ada di [ADR-0003](docs/adr/0003-test-memakai-vitest-plus-sqlite-asli-bukan-minifla.md).

## Deploy

Belum dilakukan. Sebelum deploy pertama:

1. `wrangler d1 create gapura`, lalu ganti `database_id` placeholder di `apps/worker/wrangler.toml`.
2. `wrangler d1 migrations apply gapura --remote`.
3. `wrangler secret put DUITKU_MERCHANT_CODE` dan `DUITKU_API_KEY`.
4. Sesuaikan `PANEL_ORIGIN` di `wrangler.toml` ke domain panel.

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
