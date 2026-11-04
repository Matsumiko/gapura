# 0002. Retry webhook dengan D1 dan Cron Trigger tanpa layanan berbayar

- Status: diterima
- Tanggal: 2026-11-03
- Menggantikan sebagian: ADR-0001 (bagian antrean retry)

## Konteks
ADR-0001 memilih Cloudflare Queues untuk mengulang forward webhook yang gagal. Owner kemudian menetapkan batasan biaya: hanya layanan Cloudflare free tier yang boleh dipakai; Queues, R2, dan layanan berbayar lain tidak dipakai. Kebutuhan retry tidak berubah: exponential backoff 1m, 5m, 15m, 1j, 6j, dead-letter setelah 8 percobaan dan terlihat di admin, tanpa status ganda. Volume awal kecil (lima project).

## Opsi yang dipertimbangkan
1. **Cloudflare Queues** — mekanisme paling langsung (pesan + retry bawaan), tetapi berbayar. Ditolak karena melanggar batasan.
2. **Durable Object per transaksi dengan alarm** — bisa menjadwalkan presisi per transaksi dan menyimpan state sendiri. Ditolak bukan karena biaya, tetapi karena belum dibutuhkan: backoff minimum 1 menit sudah bisa dipenuhi Cron, dan DO menambah binding, kelas, serta sumber state kedua di luar D1.
3. **KV sebagai antrean** — murah dan gratis, tetapi eventually consistent dan tidak bisa query "baris yang jatuh tempo". Tidak cocok untuk penjadwalan retry.
4. **Tabel retry di D1 + Cron Trigger** — status percobaan disimpan bersama transaksi, Cron tiap menit mengambil baris yang jatuh tempo. Satu database, tanpa binding baru.

## Keputusan
Pakai opsi 4. Retry tidak memakai antrean eksternal: jadwal percobaan disimpan di tabel `webhook_logs` (kolom `next_attempt_at` dan `status`), dan Cron Trigger `* * * * *` mengirim ulang baris `PENDING` yang sudah jatuh tempo.

Mekanik yang harus diikuti implementasi:
- Forward pertama tetap dilakukan asinkron dari callback (`waitUntil`) supaya Duitku tetap dibalas di bawah 2 detik.
- Jika forward gagal, catat percobaan ke-`n` di `webhook_logs` dengan `next_attempt_at = sekarang + backoff[n]` dan `status = 'PENDING'`; setelah percobaan ke-8 gagal, `status = 'DEAD'`.
- Cron mengambil batch kecil (mis. `LIMIT 50`) baris `PENDING` dengan `next_attempt_at <= sekarang` lewat index, lalu mengirim.
- Klaim baris sebelum kirim dengan update bersyarat (`... WHERE id = ? AND next_attempt_at <= ?`) dan lanjut hanya bila jumlah baris terubah = 1, agar dua run Cron yang tumpang tindih tidak mengirim ganda. Pengiriman tetap at-least-once; project wajib idempotent (sudah disyaratkan spesifikasi awal).

## Konsekuensi
- Positif: nol layanan berbayar dan nol binding baru; seluruh riwayat forward dan jadwal retry ada di database yang sama dengan transaksi; dead-letter cukup query `status = 'DEAD'` untuk panel admin.
- Positif: presisi retry 1 menit, cocok dengan backoff minimum 1 menit; 1440 invocation Cron per hari, jauh di bawah kuota harian free tier.
- Negatif: retry bergantung pada Cron Worker yang sama. Jika Worker gagal total, retry baru berjalan setelah pulih — jadwalnya tetap tersimpan di D1, jadi tidak hilang, hanya tertunda.
- Negatif: keterlambatan pengiriman maksimum sekitar satu menit ditambah durasi batch; tidak ada push instan seperti antrean.
- Yang harus dijaga: index pada (`status`, `next_attempt_at`), batas batch, klaim bersyarat, dan pemangkasan `webhook_logs` lama (kebijakan retensi ditetapkan di tahap retry) agar kuota D1 free tier tidak penuh.
- Durable Objects dan KV tidak dipakai sekarang. Bila nanti butuh penjadwalan presisi per transaksi atau fan-out besar, buat ADR baru yang menggantikan keputusan ini.
