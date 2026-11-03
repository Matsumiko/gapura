# Deployment

Staging berjalan di Cloudflare Workers + D1 pada `https://pay.example.com`; panel di `https://admin.example.com`. Semua langkah di bawah memakai `wrangler` dari `apps/worker` dan token dengan izin Workers Scripts + D1 (+ DNS/Access untuk domain & panel).

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

## Panel admin (sudah berjalan)

Domain dan Access:

| Item | Nilai |
|---|---|
| API Worker | `https://pay.example.com` |
| Panel Pages | `https://admin.example.com` |
| Team Access | `https://your-team.cloudflareaccess.com` |
| Access app API | `https://pay.example.com/admin` (AUD `REDACTED_AUD808652ace892c8b4b85c6a092c7916b563ef550fcaaf1f44c599f1e4`) |
| Access app panel | `https://admin.example.com` (AUD `REDACTED_AUD97328632d618c2b3bc78109f58d4e9558bc546434572f97041700e54`) |
| Access app pages.dev | `your-project.pages.dev` + wildcard `*.your-project.pages.dev` (preview) |
| Policy | allow email owner (satu-satunya identitas) |

Langkah yang sudah dijalankan:

1. Zero Trust/Access diaktifkan; dua application self-hosted dibuat + policy email owner.
2. `ACCESS_TEAM_DOMAIN` dan `ACCESS_AUD` diset di `wrangler.toml`; Worker dideploy ulang.
3. Worker custom domain `pay.example.com` dipasang lewat `routes` (`custom_domain = true`).
4. Panel dibangun dengan `VITE_API_URL=https://pay.example.com` lalu `wrangler pages deploy apps/panel/dist --project-name gapura-admin --branch main`.
5. Custom domain Pages `admin-pay.example.com` ditambahkan, plus CNAME proxied ke `your-project.pages.dev`.

Verifikasi: request tanpa sesi ke `/admin/*`, panel, `your-project.pages.dev`, dan preview `*.your-project.pages.dev` menghasilkan 302 ke login Access; `/health` tetap publik. `workers_dev = false`, jadi Worker hanya bisa diakses lewat `pay.example.com` (workers.dev menjawab 404). Bila `ACCESS_AUD` diganti, deploy ulang Worker. Jangan menonaktifkan policy Access saat panel dipakai.

## Produksi (belum dilakukan)

1. Buat D1 terpisah (`gapura-production`) dan ganti `database_id`/`database_name`.
2. Set `ENVIRONMENT = "production"`, `PUBLIC_BASE_URL` domain publik, `PANEL_ORIGIN` domain panel.
3. Pasang secret Duitku produksi (hanya setelah Fase 0 disetujui tertulis).
4. Deploy, lalu uji satu transaksi nominal kecil dan satu callback.
5. Siapkan `RUNBOOK.md`, alert, dan pemantauan sebelum mengarahkan project nyata.
