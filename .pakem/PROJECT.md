---
# Konfigurasi Pakem (dibaca mesin). Format: key: value, satu baris satu key.
# Nilai rule.*: required | skip | when-decision | when-needed. Setiap skip WAJIB punya reason.*
# exposure: private | public      (repo privat atau dipublikasikan)
# deploy: none | staging | production
# handover: true | false          (akan diserahterimakan ke orang lain)
type: app
sensitive: true
exposure: private
deploy: none
handover: false
verify: pnpm verify
reason.verify: 
rule.tests: required
reason.tests: 
rule.adr: when-decision
reason.adr: 
rule.research: when-needed
reason.research: 
rule.modular: required
reason.modular: 
---
# Gapura

Backend gerbang pembayaran di Cloudflare Workers: banyak project memakai satu akun merchant Duitku tanpa berbagi kredensial. Spesifikasi produk ada di `PRD.md`; keputusan arsitektur di `docs/adr/`.

## Ringkasan
Gapura membuat transaksi Duitku atas nama project pemanggil, menerima callback Duitku (verifikasi signature + nominal), menyimpan status di D1, lalu meneruskan status ke webhook project dengan HMAC. Panel admin (SPA React di Cloudflare Pages) dipakai owner untuk mengelola project dan memantau transaksi. Fase 1 (fondasi: Worker, D1, auth API key, panel shell) sudah berjalan lokal; transaksi Duitku baru masuk Fase 2.

## Stack
- Runtime API: Cloudflare Workers, TypeScript, Hono 4.
- Database: Cloudflare D1; skema di `apps/worker/migrations/`. Retry webhook nanti memakai Cron Trigger + tabel retry D1 (ADR-0002).
- Panel: Vite + React 19 + TanStack Query; routing/tabel/grafik menyusul di Fase 6.
- Validasi: Zod (hanya di `packages/shared/src/payment.ts`).
- Test: Vitest; migrasi SQL diuji dengan `node:sqlite` (ADR-0003).
- Monorepo: pnpm workspaces — `apps/worker`, `apps/panel`, `packages/shared`.
- Toolchain lokal: Node >= 22 (dikembangkan di 22.22), pnpm 12 lewat corepack.
- Biaya: hanya layanan Cloudflare free tier. Queues, R2, dan layanan berbayar tidak dipakai; Durable Objects/KV hanya bila ADR baru membuktikan kebutuhannya.
- Secret: Worker secrets `DUITKU_MERCHANT_CODE` dan `DUITKU_API_KEY`; API key project disimpan sebagai hash SHA-256.

## Perintah
- Setup: `pnpm install` (Node >= 22; `corepack enable pnpm` bila pnpm belum ada).
- Migrasi D1 lokal: `pnpm --filter @gapura/worker db:migrate:local`.
- Jalankan API: `pnpm --filter @gapura/worker dev` (default `127.0.0.1:8787`).
- Jalankan panel: `pnpm --filter @gapura/panel dev` (`127.0.0.1:5173`).
- Verify: `pnpm verify` — typecheck semua paket, test shared + worker, build panel, dan bundel Worker lewat `wrangler deploy --dry-run`.
- Smoke manual: jalankan `wrangler dev`, lalu `curl` endpoint; seed project memakai `wrangler d1 execute gapura --local`.

## Konvensi
- Bahasa kode dan nama API: Inggris; dokumen dan pesan error ke pengguna: Indonesia.
- Respons error selalu `{"error":{"code":"...","message":"..."}}` dengan kode stabil.
- Autentikasi project: header `X-Gapura-Key`, dicocokkan lewat hash SHA-256; key mentah tidak disimpan dan tidak di-log.
- Router tipis (`app.ts`), logika di modul terpisah, D1 hanya diakses dari `repositories/`.
- `packages/shared` tidak mengimpor app mana pun; Worker mengimpor subpath (`@gapura/shared/crypto`, dst.), bukan root, agar Zod tidak masuk bundle sebelum dipakai.
- Test tinggal di `apps/*/test` dan `packages/*/test` (Vitest). Tidak ada folder `test/` kedua di tempat lain.
- Panel mengambil base URL dari `VITE_API_URL` dan data lewat TanStack Query.
- Status transaksi hanya maju (PENDING → PAID/FAILED/EXPIRED); perubahan status harus idempotent.
- Secret hanya dari Worker secrets/`.dev.vars`; daftar variabel di `.env.example`.

## Definisi selesai
`pnpm verify` lolos; perubahan jalur HTTP/D1 juga dibuktikan smoke `wrangler dev` + D1 lokal; aplikasi bisa dijalankan dari nol mengikuti README; tidak ada secret di repo; `.pakem/` diperbarui (MODULE-MAP bila struktur berubah, DECISIONS bila ada keputusan, BUG-HISTORY bila memperbaiki bug).

Checklist keamanan (aktif karena `sensitive: true`):
- Input dari project divalidasi dengan Zod di batas sistem.
- Query D1 memakai parameter (`.bind`), bukan konkatenasi string.
- API key project dan secret webhook disimpan sebagai hash/secret manager, tidak pernah di-log.
- Otorisasi dicek di server: project hanya bisa membaca transaksinya sendiri.
- Callback Duitku diverifikasi signature dan nominalnya sebelum status diubah.
- Forward webhook ditandatangani HMAC-SHA256 + timestamp agar project bisa menolak replay.
- Data pribadi tidak muncul di log, error, atau analytics.
- Dependency dicek kerentanannya sebelum rilis.
- Ada test untuk jalur gagal (signature salah, nominal tidak cocok, akses ditolak, order tak dikenal).

## Status & artefak yang ditunda
Fase sekarang: akhir Fase 1. Sudah ada Worker (Hono) dengan `/health` dan `/v1/me`, auth API key dari D1, skema tiga tabel, panel shell, test, dan `verify` hidup. Belum ada deploy, transaksi Duitku, callback, retry, maupun panel fungsional.

Ditunda (pemicunya belum ada):
- Deploy staging (gate Fase 1): butuh akun Cloudflare dan `database_id` D1 asli; `wrangler.toml` masih memakai UUID placeholder.
- CI, `DEPLOYMENT.md`, `RUNBOOK.md`: dibuat saat deploy staging pertama; flag `deploy` dinaikkan saat itu.
- `SECURITY.md`: repo privat tanpa pelapor eksternal; dibuat saat repo dibuka atau ada kontributor luar.
- Threat model/checklist keamanan dan secret/dependency scan: checklist sudah dicatat di atas; dokumen terpisah dibuat sebelum rilis produksi (Fase 4), saat jalur pembayaran lengkap.
- Cron Trigger: baru didaftarkan di Fase 3 bersama pemroses retry; mendaftarkannya sekarang hanya handler kosong.
- Makefile/justfile: perintah sudah pendek lewat `pnpm` dan tercatat di README; dibuat bila perintah harian mulai berulang.
- Fase 0 (konfirmasi tertulis Duitku) masih terbuka dan wajib sebelum kredensial produksi dipakai.
