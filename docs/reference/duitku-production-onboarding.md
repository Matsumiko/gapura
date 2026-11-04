# Runbook onboarding produksi Duitku

Dokumen ini adalah urutan operasi untuk mengaktifkan transaksi nyata di environment `production` Gapura. Ditulis untuk operator tunggal (owner) yang memegang akses Cloudflare dan akun Duitku.

Aturan utama: **tidak ada kredensial produksi, transaksi nyata, atau onboarding project sebelum Fase 0 disetujui tertulis.** Dokumen ini tidak menggantikan persetujuan itu.

## 1. Fase 0 — blocker tertulis

Fase 0 adalah validasi ke Duitku bahwa **satu akun merchant dipakai untuk beberapa project/domain lewat satu backend Gapura** diizinkan. Gate-nya adalah jawaban tertulis dari Duitku (email/tiket), bukan asumsi dari dokumentasi vendor.

Sebelum gate ini lolos:

- Jangan menyimpan merchant code/API key produksi di panel, D1, atau secret Worker.
- Jangan mengarahkan project nyata ke `/production`.
- Jangan menjalankan transaksi nominal nyata sebagai "uji coba".

Checklist gate:

- [ ] Pertanyaan dikirim ke support/account manager Duitku dengan pola arsitektur yang jelas (1 merchant, 1 backend, N project, callback per project lewat webhook Gapura).
- [ ] Jawaban tertulis diterima dan disimpan (tanggal, pengirim, isi persetujuan, batasan yang disebutkan).
- [ ] Batasan vendor dicatat: channel yang diizinkan, batas nominal, kewajiban KYC project, dan apakah tiap project butuh merchant code sendiri.
- [ ] Bila jawabannya menolak: **stop**. Jangan akali dengan merchant code terpisah per project di panel; itu keputusan arsitektur baru, bukan langkah onboarding.

Tempat mencatat: dokumen internal rilis/ops (mis. catatan rilis atau tiket internal). Jangan menaruh isi persetujuan di repo publik.

## 2. Prasyarat teknis

| Prasyarat | Cara cek | Catatan |
|---|---|---|
| D1 produksi terpisah | `wrangler d1 list` | `gapura-production` (binding `DB_PRODUCTION`) harus beda dari `gapura-sandbox` |
| Migrasi sudah diterapkan | `wrangler d1 migrations list gapura-production --remote` | Migrasi bersifat maju saja |
| `CREDENTIALS_KEY` terpasang | panel → Pengaturan → "Master key" | Tanpa ini penyimpanan kredensial dari panel mati |
| `PUBLIC_BASE_URL` benar | `wrangler.toml` → `[vars]` | Harus URL Worker publik, HTTPS |
| Admin + TOTP aktif | login panel berhasil | Role `owner`/`admin` untuk write, `viewer` hanya baca |
| `wrangler.toml` production | `name`, `routes`, `ENVIRONMENT` | Deployment produksi sebaiknya Worker + D1 terpisah dari staging |

Callback URL yang harus dipakai Duitku (dihitung Worker, tampil di panel):

```
https://<PUBLIC_BASE_URL-host>/production/callback/duitku
```

Contoh saat ini: `https://pay.example.com/production/callback/duitku`. URL ini **tanpa** autentikasi tambahan; jangan pasang Cloudflare Access, challenge, atau WAF rule yang memblokir `POST` ke path itu.

## 3. Memasukkan kredensial produksi lewat panel

Kredensial produksi hanya masuk lewat panel pada environment **production**. Jangan memakai `wrangler secret put DUITKU_*` untuk produksi: fallback secret sengaja hanya dibaca sandbox.

1. Buka panel, pilih environment **Production** di header/sidebar.
2. Buka **Pengaturan**. Environment yang dikelola halaman ini adalah `production` (deployment `/production` menolak menyimpan environment lain).
3. Isi **Merchant code** dan **API key** dari dashboard Duitku produksi (`passport.duitku.com`). Jangan memakai kredensial sandbox.
4. Klik **Simpan**. API key disimpan terenkripsi AES-GCM di `merchant_settings` D1 produksi; API key tidak pernah dikembalikan ke panel.
5. Klik **Uji kredensial**. Hasil yang benar: jumlah channel aktif > 0 dan beberapa contoh channel. Uji ini memanggil `getPaymentMethod` ke host produksi.
6. Aktifkan environment. Panel saat ini hanya menyediakan Simpan + Uji; aktivasi adalah aksi sensitif (butuh CSRF + reauth TOTP <15 menit), jadi lakukan dari sesi panel yang baru saja reauth lalu panggil endpoint:

```sh
curl -X POST https://pay.example.com/production/admin/settings/production/activate \
  -H "Origin: https://admin.example.com" \
  -H "Cookie: __Host-gapura_admin=<sesi>" \
  -H "X-CSRF-Token: <token dari sessionStorage>"
```

Tanpa reauth segar, endpoint menjawab `403 REAUTH_REQUIRED`; tanpa header CSRF, `403 CSRF_INVALID`. Lakukan `POST /production/admin/auth/reauth` dengan kode TOTP lebih dulu bila perlu.

Atau, bila sesi panel tidak tersedia, lewat D1 produksi (satu batch supaya tidak ada dua environment aktif):

```sh
wrangler d1 execute gapura-production --remote --command \
  "UPDATE merchant_settings SET is_active = 0 WHERE is_active = 1;
   UPDATE merchant_settings SET is_active = 1 WHERE environment = 'production';"
```

Setelah aktif, `GET /production/admin/settings` harus menunjukkan `activeEnvironment: "production"`. Selama belum aktif, `POST /production/v1/payments` menjawab `503 PROVIDER_NOT_CONFIGURED`.

> Integration hook: tombol **Aktifkan** belum ada di `SettingsPage`. Sampai ditambahkan, gunakan endpoint/SQL di atas dan catat langkahnya di bukti rilis.

## 4. Gate satu transaksi live

Gate ini adalah syarat sebelum project pertama diarahkan ke produksi. Lakukan dengan nominal minimum yang diizinkan Duitku (Rp10.000) dan channel yang paling murah/VA.

1. Pastikan ada satu project pilot di D1 produksi dengan API key aktif dan webhook URL yang bisa menerima request (bukan contoh).
2. Buat transaksi:

```sh
curl -X POST https://pay.example.com/production/v1/payments \
  -H "X-Gapura-Key: <api-key-project-pilot>" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "PROD-GATE-1",
    "amount": 10000,
    "productDetails": "Gate produksi",
    "customerName": "Operator Gapura",
    "email": "ops@example.com",
    "paymentMethod": "BT",
    "returnUrl": "https://example.com/terima-kasih"
  }'
```

3. Ekspektasi: HTTP `201`, body berisi `merchantOrderId` berawalan prefix project, `paymentUrl`, `vaNumber`, status `PENDING`.
4. Bayar nominal itu dari rekening nyata memakai VA tersebut.
5. Verifikasi berurutan:
   - Callback Duitku masuk: respons `200`, tidak ada `401`/`400` berulang di Observability.
   - Transaksi berubah `PAID` di panel **Transactions** environment production.
   - `reference` dan `vaNumber` tersimpan di transaksi.
   - Catat `settlementDate`/`publisherOrderId` dari callback Duitku secara manual bila ada; Gapura belum menyimpannya.
   - Webhook project menerima `payment.status` dengan signature valid (`webhook_logs.status = 'DELIVERED'`).
   - Tidak ada `unhandled_error`/`cron_failed` di log selama gate.
6. Simpan bukti gate: timestamp, `merchantOrderId`, `reference`, nominal, status akhir, status webhook, dan screenshot/tiket. Gate ditutup hanya bila semua baris di atas benar.
7. Bila ada yang gagal: **jangan** lanjut ke project berikutnya. Perbaiki, lalu ulangi gate dengan `orderId` baru. Mengulang `orderId` yang sama dengan payload identik mengembalikan transaksi lama (`200 Idempotent-Replayed`), bukan membuat pembayaran baru; payload berbeda ditolak `409 DUPLICATE_ORDER`.

## 5. Rollback dan emergency stop

| Situasi | Tindakan | Efek |
|---|---|---|
| Kredensial produksi salah / merchant ditangguhkan | Perbaiki kredensial di panel environment production, uji, lalu transaksi baru bisa jalan lagi | Transaksi lama tetap tersimpan |
| Perlu menghentikan transaksi baru sekarang | Nonaktifkan environment produksi di D1 produksi (SQL di bawah) | `POST /production/v1/payments` → `503`; callback juga tidak bisa diverifikasi karena kredensial aktif kosong |
| Deploy kode terakhir merusak produksi | `wrangler deployments list` lalu `wrangler rollback <version-id>` | Kode kembali ke versi sebelumnya; migrasi D1 **tidak** ikut kembali |
| Bug pada satu project | Nonaktifkan project itu (`is_active = 0`) lewat panel/D1 | Project lain tidak terdampak |
| Data rusak karena migrasi | Buat migrasi koreksi baru | Jangan mengedit migrasi yang sudah diterapkan |

Emergency stop (hanya bila transaksi baru harus berhenti seketika):

```sh
wrangler d1 execute gapura-production --remote --command \
  "UPDATE merchant_settings SET is_active = 0 WHERE environment = 'production';"
```

Catatan penting:

- Menonaktifkan environment membuat verifikasi callback gagal (kredensial aktif tidak ada), sehingga callback Duitku untuk transaksi yang masih berjalan bisa ditolak. Gunakan hanya untuk menghentikan uang masuk, lalu segera aktifkan kembali setelah masalah selesai; jangan biarkan semalaman tanpa memantau transaksi pending.
- Rollback kode tidak membatalkan migrasi. Untuk perubahan skema yang merusak, buat migrasi perbaikan.
- Jangan menghapus baris `transactions`/`webhook_logs` untuk "bersih-bersih"; itu bukti keuangan dan sumber rekonsiliasi.
- Jangan mengganti `CREDENTIALS_KEY` tanpa rencana re-enkripsi: kredensial di `merchant_settings` menjadi tidak bisa didekripsi dan semua transaksi produksi berhenti.

## 6. Yang tidak boleh dilakukan

- Memasukkan kredensial produksi sebelum Fase 0 disetujui tertulis.
- Menaruh merchant code/API key produksi di `wrangler.toml`, repo, tiket publik, atau chat.
- Memakai kredensial sandbox untuk `/production` atau sebaliknya.
- Mengarahkan `/production` ke D1 staging, atau mencampur data sandbox dan produksi.
- Mengaktifkan produksi untuk semua project sekaligus; onboard satu project pilot dulu.
- Membuat transaksi "uji" dengan nominal nyata tanpa mencatat dan merekonsiliasinya.
- Memblokir `/production/callback/duitku` dengan Access/WAF challenge; Duitku tidak bisa login.
- Mengandalkan `returnUrl` sebagai bukti pembayaran; status resmi hanya dari callback/sinkronisasi.
- Menandai transaksi batal secara lokal tanpa konfirmasi vendor (tidak ada endpoint void/cancel di API v2).
- Menjalankan perintah `wrangler d1 migrations apply` ke database yang salah, atau mengedit migrasi lama.

## 7. Setelah gate

- Pantau metrik dan log sesuai `duitku-observability.md` minimal 24 jam pertama.
- Catat hasil gate dan waktu mulai produksi di catatan rilis internal.
- Tetap pertahankan channel yang belum disetujui vendor dalam keadaan nonaktif; jangan menambah channel baru sebelum diuji di sandbox.
