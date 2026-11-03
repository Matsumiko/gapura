# Deployment

Staging berjalan di Cloudflare Workers + D1. Semua langkah di bawah memakai `wrangler` dari `apps/worker` dan token dengan izin Workers Scripts + D1.

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
wrangler deploy                            # https://gapura-sandbox.<subdomain>.workers.dev

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

## Produksi (belum dilakukan)

1. Buat D1 terpisah (`gapura-production`) dan ganti `database_id`/`database_name`.
2. Set `ENVIRONMENT = "production"`, `PUBLIC_BASE_URL` domain publik, `PANEL_ORIGIN` domain panel.
3. Pasang secret Duitku produksi (hanya setelah Fase 0 disetujui tertulis).
4. Deploy, lalu uji satu transaksi nominal kecil dan satu callback.
5. Siapkan `RUNBOOK.md`, alert, dan pemantauan sebelum mengarahkan project nyata.
