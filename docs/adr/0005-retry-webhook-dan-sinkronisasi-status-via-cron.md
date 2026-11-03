# 0005. Retry webhook dan sinkronisasi status via Cron

- Status: diterima
- Tanggal: 2026-11-03

## Konteks
Fase 2 sudah mencatat jadwal retry di `webhook_logs.next_attempt_at`, tetapi belum ada pemrosesnya. PRD meminta retry exponential backoff (1m, 5m, 15m, 1j, 6j), dead-letter setelah 8 percobaan, dan sinkronisasi transaksi pending ke Duitku agar callback yang hilang tidak membuat status menggantung. Batasan tetap sama: hanya layanan Cloudflare free tier (tanpa Queues), dan Cron Trigger memiliki granularitas minimum satu menit.

## Opsi yang dipertimbangkan
1. **Cloudflare Queues** — retry bawaan dan presisi, tetapi berbayar; sudah ditolak di ADR-0002.
2. **Durable Object alarm per transaksi** — presisi detik dan state per transaksi, tetapi menambah binding/kelas dan sumber state kedua di luar D1 untuk kebutuhan yang tidak ada (backoff minimum 1 menit).
3. **Cron `* * * * *` + baris percobaan di `webhook_logs` dengan klaim bersyarat** — satu database, tanpa layanan berbayar, presisi 1 menit yang cocok dengan backoff.

## Keputusan
Pakai opsi 3.

**Arti baris `webhook_logs`**
- Satu baris = satu percobaan kirim. `status` hanya `DELIVERED` (2xx), `FAILED` (gagal; `next_attempt_at` berisi jadwal berikutnya, atau `NULL` bila sudah digantikan percobaan lain), atau `DEAD` (percobaan terakhir gagal, atau transaksi tidak ditemukan).
- Percobaan pertama (setelah status berubah) bernomor 1 dan ditulis oleh forwarder. Kegagalan mengisi `next_attempt_at = sekarang + jeda(1)`.
- Jeda per percobaan gagal ke-`n`: 1m, 5m, 15m, 1j, lalu 6j (maksimum 6j). Percobaan ke-8 adalah yang terakhir; kegagalannya menjadi `DEAD`.

**Pemroses retry (Cron)**
- Ambil maksimal 10 baris `FAILED` dengan `next_attempt_at <= sekarang`, urut jadwal.
- Klaim dengan update bersyarat `SET next_attempt_at = <lease 5 menit> WHERE id = ? AND next_attempt_at = <nilai lama>`; hanya lanjut bila satu baris berubah. Ini mencegah dua eksekusi Cron mengirim baris yang sama.
- Kirim memakai transaksi + project terkini dari D1 (bukan salinan payload lama), lalu tulis baris percobaan `n+1`; setelah itu `next_attempt_at` baris lama dikosongkan agar tidak terpilih lagi.
- Bila proses mati setelah klaim sebelum menulis hasil, lease habis dan baris diproses ulang. Pengiriman bersifat **at-least-once**; project wajib idempotent berdasarkan `merchantOrderId` + `status`.

**Sinkronisasi transaksi pending**
- Ambil maksimal 10 transaksi `PENDING` dengan `created_at <= sekarang - 10 menit`.
- `transactionStatus` Duitku: `00` → `PAID`, `02` (canceled) → `EXPIRED`, `01` (pending) → tidak berubah.
- Hanya transisi yang benar-benar berubah yang diteruskan ke webhook project (lewat forwarder, sehingga tercatat di `webhook_logs`). Kegagalan memanggil Duitku dihitung, tidak mengubah status, dan dicoba lagi pada Cron berikutnya.

Cron menjalankan retry, lalu sinkronisasi, lalu retensi. Hasil ringkas dicatat sebagai log terstruktur `cron_done`; tidak ada data pribadi di log.

## Konsekuensi
- Positif: tanpa layanan berbayar, tanpa binding baru; riwayat percobaan dan jadwal ada di satu tempat; dead-letter cukup query `status = 'DEAD'` untuk panel admin (Fase 6).
- Positif: 1440 invocation Cron per hari, jauh di bawah kuota free tier; batch 10 menjaga durasi eksekusi.
- Negatif: keterlambatan retry minimal satu menit ditambah durasi batch; tidak ada presisi detik.
- Negatif: duplikasi kirim mungkin terjadi bila proses mati setelah kirim sebelum menulis hasil (at-least-once).
- Retensi: baris `DELIVERED`/`DEAD` lebih tua dari 30 hari dipangkas oleh langkah terakhir Cron (`apps/worker/src/services/retention.ts`); baris `FAILED` yang masih terjadwal tidak pernah dipangkas.
- Yang harus dijaga: index (`status`, `next_attempt_at`), klaim bersyarat, batas batch, dan `next_attempt_at` selalu ISO 8601 UTC agar perbandingan string konsisten di SQLite.
