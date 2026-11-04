# 0003. Test memakai Vitest plus SQLite asli, bukan Miniflare

- Status: diterima
- Tanggal: 2026-11-03

## Konteks
tahap awal butuh `verify` yang cepat dan jujur: autentikasi API key, CORS, routing, dan constraint skema D1 harus benar-benar diuji, tanpa akun Cloudflare. Ada dua lapisan yang perlu dibuktikan berbeda: logika aplikasi (Hono) dan SQL migrasi (D1 adalah SQLite). Test akan dijalankan setiap sesi dan sebelum deploy, jadi kecepatan dan stabilitas di mesin lokal penting.

## Opsi yang dipertimbangkan
1. **`@cloudflare/vitest-pool-workers` (workerd + binding D1 asli).** Paling dekat dengan produksi, tetapi boot workerd per run membuat test lebih berat, menambah ketergantungan pada Miniflare/wrangler, dan memperlambat siklus.
2. **D1 palsu buatan sendiri (objek dengan method `prepare/bind/first`).** Cepat, tetapi tidak membuktikan SQL, constraint, atau index apa pun; kegagalan baru ketahuan di deploy.
3. **Vitest di Node: `buildApp` + `app.request` dengan repository palsu, dan migrasi dijalankan di `node:sqlite`.** Logika diuji lewat jalur HTTP Hono yang nyata; SQL diuji di mesin SQLite yang sama dengan D1; tidak perlu boot workerd.

## Keputusan
Pakai opsi 3. Test logika memakai Hono `app.request` dan repository in-memory; test migrasi membaca `migrations/0001_init.sql` lewat impor `?raw` dan menjalankannya di `node:sqlite`, lalu memeriksa tabel, index, UNIQUE, foreign key, dan nilai default. Perbedaan runtime Workers ditutup dengan smoke manual `wrangler dev` + D1 lokal pada perubahan jalur HTTP/D1 (dicatat di definisi selesai `PROJECT.md`).

## Konsekuensi
- Positif: `pnpm verify` selesai dalam hitungan detik; SQL salah tulis langsung gagal; tidak ada akun atau layanan berbayar yang dibutuhkan.
- Positif: test tidak terikat detail Miniflare, sehingga upgrade wrangler tidak mematahkan test logika.
- Negatif: test tidak menangkap perbedaan perilaku runtime Workers (binding, limit, API yang tidak ada di Node). Mitigasi: smoke `wrangler dev`, dan test integrasi workerd bila tahap integrasi Duitku (pemanggilan Duitku) membutuhkannya.
- Negatif: `node:sqlite` masih ditandai eksperimental di Node 22 (warning muncul saat test). Bila API-nya berubah, ganti adapter test tanpa menyentuh kode aplikasi.
- Bila nanti dibutuhkan test integrasi penuh, buat ADR baru yang menambahkan `vitest-pool-workers` untuk subset test, bukan mengganti seluruh suite.
