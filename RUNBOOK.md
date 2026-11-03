# RUNBOOK

Gejala → cek → aksi. Staging: `https://pay.example.com`.

## `/health` gagal atau 5xx

1. Cek status Cloudflare (status.cloudflare.com).
2. `cd apps/worker && wrangler tail gapura-sandbox` untuk melihat error.
3. Cek versi terakhir: `wrangler deployments list`. Bila deploy terakhir memicu masalah:
   `wrangler rollback <version-id>`.

## Project menerima 503 `PROVIDER_NOT_CONFIGURED`

Secret belum diset atau `PUBLIC_BASE_URL` kosong.

```sh
wrangler secret list
```

Set ulang:

```sh
printf '%s' '<merchant-code>' | wrangler secret put DUITKU_MERCHANT_CODE
printf '%s' '<api-key>'       | wrangler secret put DUITKU_API_KEY
```

Pastikan `PUBLIC_BASE_URL` di `wrangler.toml` adalah URL Worker yang bisa dihubungi Duitku, lalu deploy ulang.

## Project menerima 502 `PROVIDER_ERROR`

Duitku menolak inquiry atau tidak bisa dihubungi. Baris transaksi PENDING sudah dihapus, jadi project boleh mencoba lagi dengan `orderId` yang sama.

- Cek `DUITKU_BASE_URL` (sandbox vs produksi).
- Cek kredensial dan status merchant di dashboard Duitku.
- Cek `wrangler tail gapura-sandbox` untuk kode error provider (tidak ada data pribadi).

## Callback tidak masuk

1. Pastikan `PUBLIC_BASE_URL` = `https://<worker-url>` dan sudah di-deploy ulang.
2. Pastikan `callbackUrl` yang dikirim ke Duitku benar (terbentuk dari `PUBLIC_BASE_URL` + `/callback/duitku`).
3. Uji manual dengan signature yang benar (lihat ADR-0004); signature salah menghasilkan 401.
4. Periksa `wrangler tail` untuk `invalid_signature`/`amount_mismatch`.

## Webhook project gagal / menumpuk

```sh
wrangler d1 execute gapura-sandbox --remote --json --command \
  "SELECT merchant_order_id, attempt, http_status, error, status, next_attempt_at
     FROM webhook_logs WHERE status IN ('FAILED','DEAD') ORDER BY id DESC LIMIT 20"
```

- `FAILED` dengan `next_attempt_at`: Cron akan mencoba lagi (1m/5m/15m/1j/6j).
- `DEAD`: 8 percobaan habis atau transaksi hilang. Perbaiki webhook project lalu minta kirim ulang (panel admin Fase 6; sementara seed baris `FAILED` dengan `next_attempt_at` sekarang atau kirim manual).
- Jika project membalas 2xx tetapi tetap gagal, cek signature/timestamp di sisi project.

## Cron tidak berjalan

- `wrangler deployments list` — pastikan versi terbaru memiliki trigger.
- Dashboard Cloudflare → Workers → gapura-sandbox → Triggers: `* * * * *`.
- Jalankan lokal: `wrangler dev --test-scheduled` lalu `curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"`.
- Lihat `cron_done`/`cron_failed` di `wrangler tail`.

## Kuota D1 penuh

- Cek baris: `SELECT COUNT(*) FROM webhook_logs;`
- Retensi otomatis memangkas `DELIVERED`/`DEAD` lebih dari 30 hari; `FAILED` terjadwal sengaja disimpan.
- Turunkan `DEFAULT_RETENTION_MS` di `apps/worker/src/services/retention.ts` bila perlu, dengan test.

## Panel admin

- `503 ADMIN_NOT_CONFIGURED`: `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` belum diset atau Access belum aktif. Panel memang tidak bisa dipakai.
- `401 ADMIN_UNAUTHORIZED`: sesi Access habis atau domain/AUD tidak cocok. Login ulang lewat Access; cek `aud` application.
- Halaman kosong/`403`: policy Access tidak mengizinkan email tersebut.
- Tombol kirim ulang webhook mengubah baris `DEAD`/`FAILED` menjadi jadwal baru (attempt 1, jatuh tempo sekarang); Cron berikutnya mengirim.

## Eskalasi

Owner tunggal. Untuk insiden yang menyentuh uang atau data pembeli: hentikan rollout project baru, rollback bila perlu, lalu catat di `BUG-HISTORY`/`INCIDENTS` setelah pulih.
