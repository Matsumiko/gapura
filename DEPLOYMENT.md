# Deployment

Staging berjalan di Cloudflare Workers + D1 pada `https://pay.example.com`; panel di `https://admin.example.com`. Semua langkah di bawah memakai `wrangler` dari `apps/worker` dan token dengan izin Workers Scripts + D1 (+ DNS/Pages untuk domain & panel).

## Prasyarat

- Akun Cloudflare dengan Workers + D1 aktif (free tier cukup).
- `CLOUDFLARE_API_TOKEN` (atau `wrangler login`) dengan izin edit Workers dan D1.
- Kredensial Duitku sandbox untuk uji transaksi nyata (belum tersedia saat dokumen ini dibuat).

## Staging (sudah dilakukan)

```sh
cd apps/worker

# 1. Database
wrangler d1 create gapura-sandbox          # catat database_id → wrangler.toml

# 2. Skema
wrangler d1 migrations apply gapura-sandbox --remote

# 3. Deploy
wrangler deploy                            # https://pay.example.com (custom domain)

# 4. Variabel publik
#    PUBLIC_BASE_URL di wrangler.toml = URL Worker (dipakai sebagai callbackUrl Duitku),
#    lalu deploy ulang.

# 5. Secret
printf '%s' '<merchant-code>' | wrangler secret put DUITKU_MERCHANT_CODE
printf '%s' '<api-key>'       | wrangler secret put DUITKU_API_KEY
openssl rand -base64 32       | wrangler secret put CREDENTIALS_KEY
openssl rand -hex 32          | wrangler secret put ADMIN_SETUP_TOKEN

# 6. Project pertama
#    API key dibuat acak (gpk_...), hanya hash SHA-256 yang disimpan.
wrangler d1 execute gapura-sandbox --remote --command \
  "INSERT INTO projects (id, name, prefix, api_key_hash, webhook_url, webhook_secret, is_active, created_at)
   VALUES ('proja', 'Project A', 'PRJA', '<sha256-hex>', 'https://project-a.example/hook', '<whsec>', 1, '<iso>')"
```

## Verifikasi setelah deploy

```sh
curl https://<worker-url>/health
curl -H "X-Gapura-Key: <api-key>" https://<worker-url>/v1/me
```

Cek log:

```sh
wrangler tail gapura-sandbox
```

## Rollback

```sh
wrangler deployments list
wrangler rollback <version-id>
```

Migrasi D1 bersifat maju saja; rollback kode tidak membatalkan migrasi. Untuk perubahan skema yang merusak, buat migrasi baru yang memperbaiki, bukan mengedit migrasi lama.

## Dua environment (route + D1)

- `/sandbox/*` → binding `DB_SANDBOX` (`gapura-sandbox`), callback `https://pay.example.com/sandbox/callback/duitku`.
- `/production/*` → binding `DB_PRODUCTION` (`gapura-production`), callback `https://pay.example.com/production/callback/duitku`.
- Migrasi sudah dijalankan untuk **kedua** database (`gapura-sandbox` dan `gapura-production`).
- Status live: `/sandbox` memakai kredensial sandbox dari panel; `/production` kosong sampai kredensial production diisi.
- Panel memilih environment di header; semua request admin diberi prefix env.
- Admin auth terpusat di D1 `gapura-auth` (`DB_AUTH`): satu email/password/TOTP dan satu sesi cookie untuk sandbox maupun production. Pindah environment tidak perlu login ulang.
- Path lama `/v1`, `/callback/duitku`, `/admin` tetap sandbox (kompatibilitas).

## Kredensial Duitku dari panel

1. Set master key: `openssl rand -base64 32 | wrangler secret put CREDENTIALS_KEY`.
2. Terapkan migrasi `0001`–`0005` (`wrangler d1 migrations apply gapura-sandbox --remote`); `0005_admin_auth.sql` membuat `admin_users`, `admin_sessions`, dan `admin_login_attempts`.
3. Buat owner pertama lewat panel: `ADMIN_SETUP_TOKEN` + email + password (min. 12 karakter), daftarkan secret TOTP dari URI `otpauth://`, lalu masukkan kode 6 digit.
4. Di panel → Pengaturan (environment Sandbox): isi merchant code + API key, Simpan, Uji kredensial. Aktifkan agar kredensial panel dipakai: `POST /sandbox/admin/settings/sandbox/activate` (belum ada tombolnya di panel). Tanpa aktivasi, sandbox memakai fallback secret `DUITKU_*` bila terpasang.
5. Production: isi kartu Production dan aktifkan hanya setelah Fase 0 disetujui tertulis. Ikuti `docs/reference/duitku-production-onboarding.md` (blocker, gate satu transaksi, rollback, larangan).
6. Tanpa `CREDENTIALS_KEY`, penyimpanan dinonaktifkan dan Worker memakai fallback secret `DUITKU_*`. Secret TOTP admin juga butuh `CREDENTIALS_KEY`, jadi bootstrap gagal tanpanya.

Catatan aktivasi: panel saat ini hanya punya Simpan + Uji kredensial; aktivasi environment dilakukan lewat `POST /<env>/admin/settings/<env>/activate` atau satu batch SQL `merchant_settings` (lihat runbook produksi). Fallback `DUITKU_*` hanya dibaca untuk sandbox.

## Panel admin (Pages + sesi)

| Item | Nilai |
|---|---|
| API Worker | `https://pay.example.com` |
| Panel Pages | `https://admin.example.com` (project `gapura-admin`) |
| Alias Pages | `https://your-project.pages.dev` (dialihkan ke domain kanonik oleh `apps/panel/public/host-guard.js`; cookie `SameSite=Strict`) |
| Auth | Sesi opaque cookie `__Host-gapura_admin` (`HttpOnly`, `Secure`, `SameSite=Strict`) + TOTP; CSRF token di sessionStorage |

Langkah yang sudah dijalankan:

1. Worker custom domain `pay.example.com`; `workers_dev = false` sehingga hanya host itu yang melayani.
2. Migrasi `0005_admin_auth.sql` diterapkan ke `gapura-sandbox` dan `gapura-production`.
3. Secret `CREDENTIALS_KEY` (32 byte base64) dan `ADMIN_SETUP_TOKEN` (sementara) dipasang lewat `wrangler secret put`.
4. Build panel: `VITE_API_URL=https://pay.example.com pnpm --filter @gapura/panel build`.
5. Deploy Pages: `wrangler pages deploy apps/panel/dist --project-name gapura-admin --branch main`.
6. Custom domain Pages `admin-pay.example.com` + CNAME proxied ke `your-project.pages.dev`.
7. `PANEL_ORIGIN` di `wrangler.toml` memuat origin panel (`admin-pay.example.com` dan `your-project.pages.dev`); CORS mengizinkan header `X-CSRF-Token` dan mengirim kredensial.

Bootstrap owner (sekali per environment/D1): buka panel → isi `ADMIN_SETUP_TOKEN`, email, password → simpan secret `otpauth://` di authenticator → masukkan kode TOTP. Setelah `admin_users` terisi, bootstrap menolak (`SETUP_CLOSED`); hapus secret `ADMIN_SETUP_TOKEN` dengan `wrangler secret delete ADMIN_SETUP_TOKEN`.

Verifikasi: `/health` 200; `/admin/summary` tanpa sesi 401; `/admin/auth/audit` tanpa sesi 401 dan dengan sesi owner/admin 200; login panel berhasil dan menampilkan ringkasan/project/transaksi dari D1. Write tanpa `X-CSRF-Token` ditolak 403; aksi sensitif tanpa reauth segar ditolak 403 `REAUTH_REQUIRED`.

Mencabut akses: logout dari panel (menghapus baris sesi itu), atau `DELETE FROM admin_sessions WHERE admin_id = '<id>'` lewat D1 untuk semua perangkat. Tidak ada token statis yang perlu dirotasi. Bila authenticator hilang, pemulihan manual di D1 (recovery codes belum diimplementasikan).

Argon2id (`m=19456 KiB, t=2, p=1`) diukur lokal pada 2026-11-04: hash ~382 ms dan verify ~376 ms median (Node 22, Xeon E5-2680 v3). Workers free tier hanya memberi 10 ms CPU per invocation, sehingga login/bootstrap hampir pasti melewati batas; jalankan auth di Workers Paid atau pindahkan hashing ke layanan terpisah. Parameter tidak diturunkan: `m=19456, t=2` adalah batas minimum OWASP, dan menurunkan lebih jauh melemahkan proteksi tanpa realistis mencapai 10 ms. Detail dan cara mengukur ulang ada di `RUNBOOK.md` (`pnpm bench:argon2`).

Cron tiap menit juga membersihkan `admin_sessions` kedaluwarsa dan `admin_login_attempts` lebih dari 30 hari di `DB_AUTH` (job `admin_maintenance`). Audit login/keamanan dibaca lewat `GET /admin/auth/audit?limit=` (owner/admin).

## Produksi (belum dilakukan)

Blocker: **Fase 0 harus disetujui tertulis oleh Duitku** sebelum langkah 3. Urutan lengkap, gate, rollback, dan larangan ada di `docs/reference/duitku-production-onboarding.md`.

1. Buat D1 terpisah (`gapura-production`) dan ganti `database_id`/`database_name`.
2. Set `ENVIRONMENT = "production"`, `PUBLIC_BASE_URL` domain publik, `PANEL_ORIGIN` domain panel. Deploy Worker production terpisah dari staging bila memungkinkan.
3. Isi kredensial Duitku produksi lewat panel pada environment **Production** (bukan `wrangler secret`; fallback secret hanya untuk sandbox). Uji kredensial, lalu aktifkan environment production.
4. Pastikan callback URL `https://<host>/production/callback/duitku` dapat dihubungi Duitku: tanpa Access/challenge, HTTPS, `PUBLIC_BASE_URL` benar.
5. Gate satu transaksi live nominal minimum + satu callback + satu webhook project. Jangan arahkan project lain sebelum gate lolos.
6. Aktifkan observability (`[observability] enabled = true`) dan ikuti `docs/reference/duitku-observability.md`; siapkan rollback (`wrangler deployments list`/`rollback`, nonaktifkan environment) sebelum project nyata diarahkan.
