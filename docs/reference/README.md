# Referensi Duitku untuk Gapura

Dokumen di folder ini adalah hasil pembacaan dokumentasi vendor Duitku API v2 dan pengujian sandbox. Tujuannya supaya implementasi Gapura tidak menebak-nebak kontrak vendor.

Sumber utama (diakses 2026-11-03):

- https://docs.duitku.com/api/id/ (API v2, Bahasa Indonesia)
- https://docs.duitku.com/api/id/#langkah-awal
- https://docs.duitku.com/api/id/#request-http-transaksi
- https://docs.duitku.com/api/id/#callback
- https://docs.duitku.com/api/id/#cek-transaksi
- https://docs.duitku.com/api/id/#metode-pembayaran
- https://docs.duitku.com/api/id/#expiry-period
- https://docs.duitku.com/api/id/#http-code
- https://docs.duitku.com/api/id/#uji-coba

## Isi

| File | Isi |
|---|---|
| [duitku-api.md](duitku-api.md) | Endpoint, signature HMAC, parameter inquiry, account link, Fixed VA (SNAP), callback, cek transaksi, redirect, kode error, pemetaan ke Gapura |
| [duitku-payment-methods.md](duitku-payment-methods.md) | Katalog 32 channel per sistem, expiry, void, account link, Fixed VA, batas nominal/order ID, channel aktif di sandbox |
| [duitku-production-onboarding.md](duitku-production-onboarding.md) | Runbook produksi: blocker persetujuan tertulis Duitku, kredensial via panel, callback URL, gate satu transaksi, rollback, larangan |
| [duitku-observability.md](duitku-observability.md) | Baseline observability gratis: log yang sudah ada, alert create 5xx/callback/webhook/cron/D1, lokasi dashboard |

Katalog machine-readable ada di `packages/shared/src/payment-methods.ts` dan dipakai panel untuk menampilkan nama channel serta halaman Dokumentasi. Bila vendor mengubah daftar, perbarui katalog dan kedua file ini.

## Peringatan

- **Channel aktif berbeda per merchant.** Tabel vendor adalah kandidat; yang benar-benar bisa dipakai harus diambil lewat `getPaymentMethod`. Biaya (`totalFee`) juga dari endpoint itu, bukan dari dokumen ini.
- **Signature: HMAC-SHA256.** Sejak perubahan April 2026, MD5 dan SHA-256 biasa dinyatakan obsolete oleh vendor. Gapura hanya memakai HMAC-SHA256.
- Angka dan aturan di sini adalah salinan dokumentasi vendor per tanggal akses; verifikasi ulang sebelum rilis produksi.
