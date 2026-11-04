---
# Konfigurasi Pakem (dibaca mesin). Format: key: value, satu baris satu key.
# Nilai rule.*: required | skip | when-decision | when-needed. Setiap skip WAJIB punya reason.*
# exposure: private | public      (repo privat atau dipublikasikan)
# deploy: none | staging | production
# handover: true | false          (akan diserahterimakan ke orang lain)
type: app
sensitive: true
exposure: private
deploy: staging
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
Gapura membuat transaksi Duitku atas nama project pemanggil, menerima callback Duitku (verifikasi signature + nominal), menyimpan status di D1, lalu meneruskan status ke webhook project dengan HMAC. Panel admin (SPA React di Cloudflare Pages) dipakai owner untuk mengelola project dan memantau transaksi. Fase 1-3 berjalan dan staging live; Fase 6 (admin API + panel) live dengan sesi opaque + TOTP + RBAC + step-up. Total 243 test.

## Stack
- Runtime API: Cloudflare Workers, TypeScript, Hono 4.
- Database: Cloudflare D1; skema di `apps/worker/migrations/`. Retry webhook nanti memakai Cron Trigger + tabel retry D1 (ADR-0002).
- Panel: Vite + React 19 + TanStack Query; routing/tabel/grafik menyusul di Fase 6.
- Validasi: Zod (hanya di `packages/shared/src/payment.ts`).
- Test: Vitest; migrasi SQL diuji dengan `node:sqlite` (ADR-0003).
- Referensi vendor: `docs/reference/duitku-api.md` dan `docs/reference/duitku-payment-methods.md`; katalog channel di `packages/shared/src/payment-methods.ts`.
- Integrasi Duitku: API v2 dengan signature HMAC-SHA256 (ADR-0004).
- Monorepo: pnpm workspaces — `apps/worker`, `apps/panel`, `packages/shared`.
- Toolchain lokal: Node >= 22 (dikembangkan di 22.22), pnpm 12 lewat corepack.
- Biaya: hanya layanan Cloudflare free tier. Queues, R2, dan layanan berbayar tidak dipakai; Durable Objects/KV hanya bila ADR baru membuktikan kebutuhannya.
- Auth admin memakai sesi opaque + TOTP + RBAC + step-up (ADR-0010): password Argon2id, cookie `__Host-gapura_admin` HttpOnly, CSRF per sesi, role owner/admin/viewer, reauth 15 menit untuk aksi sensitif. Token statis sudah dihapus dari Worker dan panel.
- Secret: Worker secrets `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`, `CREDENTIALS_KEY`, dan `ADMIN_SETUP_TOKEN` (sementara, untuk bootstrap owner); kredensial Duitku dan secret TOTP admin disimpan terenkripsi di D1 (ADR-0008); API key project disimpan sebagai hash SHA-256.

## Perintah
- Setup: `pnpm install` (Node >= 22; `corepack enable pnpm` bila pnpm belum ada).
- Migrasi D1 lokal: `pnpm --filter @gapura/worker db:migrate:local`.
- Jalankan API: `pnpm --filter @gapura/worker dev` (default `127.0.0.1:8787`).
- Jalankan panel: `pnpm --filter @gapura/panel dev` (`127.0.0.1:5173`).
- Verify: `pnpm verify` — typecheck semua paket, test shared + worker, build panel, dan bundel Worker lewat `wrangler deploy --dry-run`.
- Smoke manual: jalankan `wrangler dev`, lalu `curl` endpoint; seed project memakai `wrangler d1 execute gapura --local`.
- Deploy staging: lihat `DEPLOYMENT.md`; rollback dan triage di `RUNBOOK.md`. Untuk callback, hitung signature dengan kunci di `apps/worker/.dev.vars` (lihat ADR-0004). Untuk Cron, jalankan `wrangler dev --test-scheduled` lalu `curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"`; arahkan `DUITKU_BASE_URL` ke stub lokal bila tidak memakai sandbox.

## Konvensi
- Bahasa kode dan nama API: Inggris; dokumen dan pesan error ke pengguna: Indonesia.
- Respons error selalu `{"error":{"code":"...","message":"..."}}` dengan kode stabil.
- Autentikasi project: header `X-Gapura-Key`, dicocokkan lewat hash SHA-256; key mentah tidak disimpan dan tidak di-log.
- Router tipis (`app.ts`), logika di modul terpisah, D1 hanya diakses dari `repositories/`.
- `packages/shared` tidak mengimpor app mana pun; Worker mengimpor subpath (`@gapura/shared/crypto`, dst.), bukan root, agar Zod tidak masuk bundle sebelum dipakai.
- Test tinggal di `apps/*/test` dan `packages/*/test` (Vitest). Tidak ada folder `test/` kedua di tempat lain.
- Panel mengambil base URL dari `VITE_API_URL` dan data lewat TanStack Query.
- Status transaksi hanya maju (PENDING → PAID/FAILED/EXPIRED) lewat update bersyarat `WHERE status = 'PENDING'`; forward hanya dikirim saat transisi benar-benar terjadi.
- `webhook_logs` satu baris per percobaan: `FAILED` (dengan/ tanpa jadwal), `DELIVERED`, `DEAD`. Retry diklaim dengan lease 5 menit; pengiriman at-least-once, project wajib idempotent (ADR-0005).
- Signature Duitku memakai HMAC-SHA256 dengan urutan parameter vendor (ADR-0004); `amount` pada callback dibandingkan sebagai string mentah yang ditandatangani.
- Webhook keluar: header `X-Gapura-Signature: t=<unix>,v1=<hex>` atas `<t>.<body>` dengan secret project.
- Timestamp di database disimpan sebagai ISO 8601 UTC (`toISOString`).
- Secret hanya dari Worker secrets/`.dev.vars`; daftar variabel di `.env.example`.

## Definisi selesai
`pnpm verify` lolos; perubahan jalur HTTP/D1 juga dibuktikan smoke `wrangler dev` + D1 lokal, dan perubahan callback/forward dibuktikan dengan receiver webhook lokal yang memverifikasi signature; aplikasi bisa dijalankan dari nol mengikuti README; tidak ada secret di repo; `.pakem/` diperbarui (MODULE-MAP bila struktur berubah, DECISIONS bila ada keputusan, BUG-HISTORY bila memperbaiki bug).

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
Fase sekarang: Fase 6 selesai di kode, staging live untuk API pembayaran. Worker `https://pay.example.com` (satu-satunya host; workers.dev dimatikan) melayani `/sandbox` (D1 `gapura-sandbox`) dan `/production` (D1 `gapura-production`) dengan admin auth terpusat di D1 `gapura-auth`, keduanya sudah dimigrasi dan live, migrasi 0001-0005 remote, Cron aktif, retensi 30 hari, dan kredensial sandbox asli. Pembayaran sandbox nyata lewat demo Duitku berhasil: callback asli membuat transaksi PAID dan webhook project DELIVERED. Admin API live di `https://pay.example.com/admin/*` dengan sesi opaque + TOTP, dan panel live di `https://admin.example.com` (Pages) dengan login email/password/TOTP; `your-project.pages.dev` hanya untuk redirect ke domain kanonik (`SameSite=Strict`). Request tanpa sesi ke `/admin/*` ditolak 401, write tanpa CSRF 403, dan aksi sensitif tanpa reauth segar 403 `REAUTH_REQUIRED`. Access apps sudah dihapus dan `ACCESS_*` dilepas (ADR-0007). Production D1 ada dan terisolasi, tetapi kredensial production belum diset (create payment production 503, tidak memakai fallback sandbox). Deploy produksi (rilis nyata) belum.

Ditunda (pemicunya belum ada):
- Deploy produksi: butuh D1 produksi terpisah dan kredensial Duitku asli setelah Fase 0 disetujui.
- CI, `DEPLOYMENT.md`, `RUNBOOK.md`: dibuat saat deploy staging pertama; flag `deploy` dinaikkan saat itu.
- CI (`pakem ci`/GitHub Actions): belum ada remote GitHub; workflow dibuat saat repo punya remote.
- Rate limit per project (FR-10): ditunda; andalkan Cloudflare/WAF sebelum produksi (lihat `docs/SECURITY_CHECKLIST.md`). Rate limit login/TOTP admin sudah ada (5 gagal / 15 menit per akun + IP).
- Retensi `webhook_logs`: selesai (30 hari untuk DELIVERED/DEAD, lihat ADR-0005 dan `apps/worker/src/services/retention.ts`).
- Panel dan API admin dideploy dengan sesi + TOTP (tanpa Zero Trust). WAF dan D1 produksi masih tertunda. Recovery code TOTP belum ada; CPU Argon2id di Workers free tier belum diukur.
- Transaksi sandbox Duitku sungguhan: butuh kredensial merchant sandbox dan jawaban Fase 0.
- Makefile/justfile: perintah sudah pendek lewat `pnpm` dan tercatat di README; dibuat bila perintah harian mulai berulang.
- Fase 0 (konfirmasi tertulis Duitku) masih terbuka dan wajib sebelum kredensial produksi dipakai.
