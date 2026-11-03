# 0004. Kontrak integrasi Duitku v2 dan webhook keluar

- Status: diterima
- Tanggal: 2026-11-03

## Konteks
PRD menyebut signature callback memakai MD5, tetapi dokumentasi Duitku API v2 (https://docs.duitku.com/api/id/) memakai **HMAC-SHA256** untuk inquiry, callback, dan cek transaksi. Gapura adalah satu akun merchant untuk banyak project, jadi Duitku hanya mengenal satu `callbackUrl` milik Gapura, sementara tiap project punya webhook dan secret sendiri. Status tidak boleh rusak oleh callback berulang, dan project harus bisa memverifikasi bahwa forward benar berasal dari Gapura.

## Opsi yang dipertimbangkan
1. **Verifikasi MD5 sesuai PRD awal.** Tidak sesuai dokumentasi vendor saat ini; akan menolak semua callback asli.
2. **Satu callbackUrl per project didaftarkan di Duitku.** Duitku tidak mendukung banyak URL per akun merchant; menambah project berarti mengubah konfigurasi vendor.
3. **Satu callbackUrl Gapura, project dikenali dari `merchantOrderId`, forward ditandatangani per project (dipilih).** Vendor hanya melihat satu endpoint; isolasi antar project dijaga oleh prefix order ID dan secret masing-masing.
4. **Forward ke project memakai signature sederhana tanpa timestamp.** Rentan replay; PRD meminta timestamp.

## Keputusan
Pakai opsi 3 dengan detail kontrak berikut.

**Ke Duitku (API v2, `DUITKU_BASE_URL`)**
- Inquiry: `POST /webapi/api/merchant/v2/inquiry`, body JSON berisi `merchantCode`, `paymentAmount` (integer), `paymentMethod` (kode 2 karakter), `merchantOrderId`, `productDetails`, `customerVaName` (dipotong 20 karakter sesuai batas vendor), `email`, `returnUrl`, `callbackUrl`, `signature`.
- `signature = HMAC_SHA256(merchantCode + merchantOrderId + paymentAmount, apiKey)` hex lowercase.
- Cek transaksi (Fase 3): `signature = HMAC_SHA256(merchantCode + merchantOrderId, apiKey)`.

**Callback dari Duitku**
- `POST /callback/duitku`, `application/x-www-form-urlencoded`.
- `signature = HMAC_SHA256(merchantCode + amount + merchantOrderId, apiKey)` dengan `amount` **string mentah** dari form; dibandingkan waktu-konstan.
- `merchantCode` harus sama dengan milik Gapura; nominal integer harus sama dengan transaksi tersimpan; order tak dikenal diabaikan (tetap balas 200 agar Duitku berhenti mengulang).
- `resultCode` `00` → `PAID`, selain itu `FAILED`. Hanya transisi dari `PENDING` yang diterapkan; callback berulang tidak mengubah apa pun dan **tidak** memicu forward ulang.

**Webhook keluar (Gapura → project)**
- `POST` JSON ke `webhook_url` project, dengan header:
  - `X-Gapura-Event: payment.status`
  - `X-Gapura-Signature: t=<unix-seconds>,v1=<hex>`
- `v1 = HMAC_SHA256(<t> + "." + body, webhook_secret_project)`, `body` adalah byte JSON persis yang dikirim.
- Project wajib menolak timestamp di luar toleransi (disarankan 5 menit) dan memproses idempotent terhadap `merchantOrderId` + `status`.
- Respons 2xx = terkirim. Selain itu dicatat di `webhook_logs` dengan `next_attempt_at` (retry pertama +1 menit); pemroses retry/Cron menyusul di Fase 3.

**Penanganan kegagalan pembuatan transaksi**
- Bila inquiry Duitku gagal **sebelum** transaksi dibuat di sisi vendor, baris `PENDING` dihapus supaya project bisa memakai `orderId` yang sama untuk mencoba lagi.
- Bila inquiry berhasil tetapi penyimpanan hasil ke D1 gagal, baris `PENDING` **tidak** dihapus (transaksi vendor sudah ada); project dapat memeriksa lewat `GET /v1/payments/:orderId`.

## Konsekuensi
- Positif: hanya satu endpoint yang perlu didaftarkan ke Duitku; isolasi project tetap terjaga; status idempotent karena update bersyarat `WHERE status = 'PENDING'`.
- Positif: project dapat memverifikasi forward tanpa memanggil balik Gapura, dan replay ditolak lewat timestamp.
- Negatif: `customerVaName` terpotong 20 karakter pada halaman konfirmasi bank; `paymentMethod` wajib kode 2 karakter milik Duitku.
- Negatif: callback harus tetap di bawah 2 detik, sehingga forward dilakukan asinkron (`waitUntil`); kegagalan forward baru terlihat di `webhook_logs`, bukan di respons callback.
- Yang harus dijaga: rahasia Duitku hanya di Worker secrets; `PUBLIC_BASE_URL` harus URL publik yang bisa dihubungi Duitku; prefix project unik karena parsing `merchantOrderId` mengandalkan pemisah pertama.
- Bila Duitku mengganti skema signature lagi, perubahan menyentuh `apps/worker/src/providers/duitku.ts` dan ADR baru; jangan mengubah PRD diam-diam.
