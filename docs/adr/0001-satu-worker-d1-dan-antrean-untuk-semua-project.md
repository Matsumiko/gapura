# 0001. Satu Worker, D1, dan antrean untuk semua project

- Status: diterima; bagian antrean retry (Cloudflare Queues) digantikan ADR-0002 karena batasan free tier. Keputusan lain di sini tetap berlaku.
- Tanggal: 2026-11-03

> Revisi 2026-11-03: semua rujukan Cloudflare Queues di bawah digantikan ADR-0002 (Cron Trigger + tabel retry D1) karena batasan free tier. Teks asli dibiarkan sebagai riwayat.

## Konteks
Ada lima project yang butuh pembayaran, sedangkan Duitku memberi satu akun merchant per pengajuan dan pengajuan akun tambahan sulit serta lama. Kredensial merchant tidak boleh tersebar ke tiap project. Volumenya masih kecil, owner tunggal, dan target biaya adalah tier gratis/murah Cloudflare. Pada saat yang sama, keandalan status pembayaran adalah syarat utama: callback harus dibalas di bawah 2 detik, create payment p95 di bawah 300 ms di luar waktu Duitku, dan status tidak boleh rusak oleh callback berulang.

## Opsi yang dipertimbangkan
1. **Tiap project memanggil Duitku langsung dengan kredensial sendiri.** Paling sederhana secara arsitektur, tetapi kredensial merchant tersebar ke lima repo, pengajuan akun tambahan lama, dan tidak ada tempat tunggal untuk memantau transaksi. Bertentangan dengan tujuan produk awal.
2. **Backend perantara (Gapura) yang memegang kredensial, berjalan di container/VPS dengan Postgres dan antrean mandiri (mis. BullMQ).** Kontrol penuh dan tidak terikat batas D1, tetapi menambah biaya server, region tunggal, dan beban operasional (patch, backup, monitoring) untuk owner tunggal.
3. **Backend perantara di Cloudflare Workers, data di D1, retry di Queues (alternatif: Cron Trigger), panel terpisah di Pages.** Edge global, biaya rendah, satu deploy, dan cocok untuk beban awal. Konsekuensinya terikat batas D1 dan kuota Queues.
4. **Menambah abstraksi multi-provider sejak v1.** Menyiapkan provider selain Duitku lebih awal, tetapi menambah lapisan yang belum terbukti dibutuhkan dan memperlambat rilis pertama.

## Keputusan
Pakai opsi 3: satu Worker (TypeScript + Hono) yang memegang kredensial Duitku, D1 untuk `projects`, `transactions`, dan `webhook_logs`, dan Queues untuk forward webhook yang gagal (Cron Trigger sebagai cadangan). Panel admin adalah SPA terpisah di Cloudflare Pages dalam monorepo pnpm. Integrasi Duitku dibungkus satu modul provider dengan antarmuka sempit, tetapi hanya Duitku yang diimplementasikan di v1 (opsi 4 ditunda ke P2).

Alasan utama: kebutuhan utamanya adalah satu titik integrasi yang andal dan murah, bukan kontrol infrastruktur. Opsi 3 memenuhi itu tanpa server yang harus dirawat. Opsi 4 ditunda karena antarmuka provider baru layak dibekukan setelah satu provider benar-benar berjalan.

## Konsekuensi
- Positif: kredensial Duitku hanya ada di Worker secrets; onboarding project baru tanpa deploy ulang (data project dibaca dari D1 tiap request); biaya dan operasional minimal; forward webhook asinkron menjaga callback tetap di bawah 2 detik.
- Negatif: Gapura menjadi satu titik kegagalan untuk semua project; D1 adalah database tunggal sehingga kehilangan data berarti kehilangan riwayat semua project; Worker dan D1 punya batas kuota/ukuran yang harus dipantau.
- Yang harus dijaga: status hanya maju dan semua perubahan idempotent; constraint UNIQUE `merchant_order_id` dan (`project_id`, `project_order_id`); verifikasi signature dan nominal sebelum update; forward ditandatangani HMAC + timestamp; dead-letter setelah 8 percobaan dan terlihat di admin.
- Perlu diverifikasi sebelum tahap awal: kuota dan biaya Queues/D1 untuk volume awal, serta izin merchant Duitku untuk pola satu akun banyak project (persetujuan tertulis Duitku, masih terbuka).
- Bila kelak butuh multi-provider atau volume melewati batas D1, keputusan ini diganti lewat ADR baru, bukan diubah diam-diam.
