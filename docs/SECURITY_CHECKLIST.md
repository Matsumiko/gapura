# Checklist keamanan & threat model ringkas

Diperbarui: 2026-11-03. Berlaku untuk Worker staging `gapura-sandbox`.

## Ancaman dan mitigasi saat ini

| Ancaman | Dampak | Mitigasi | Status |
|---|---|---|---|
| Callback palsu | Transaksi dianggap lunas tanpa uang masuk | Signature HMAC-SHA256 Duitku diverifikasi waktu-konstan; `merchantCode` harus cocok | Ada + test |
| Callback diubah nominalnya | Status untuk nominal lain | Nominal callback (string mentah yang ditandatangani) dibandingkan dengan nominal tersimpan | Ada + test |
| Callback berulang | Status ganda / forward ganda | Transisi hanya dari `PENDING` lewat update bersyarat; forward hanya saat berubah | Ada + test |
| Replay webhook keluar | Project memproses ulang | Header `t` + `v1` HMAC atas `t.body`; project wajib menolak timestamp lama | Ada; toleransi di sisi project |
| API key project bocor | Transaksi atas nama project | Hash SHA-256 di D1, rotasi key (Fase 6), rate limit belum ada | Sebagian; rate limit tertunda |
| Order ID bentrok antar project | Status tertukar | Prefix 3-6 huruf unik + `UNIQUE (project_id, project_order_id)` + `merchant_order_id` PK | Ada + test |
| SQL injection | Baca/ubah data | Semua query D1 memakai `.bind()` parameter | Ada |
| SSRF lewat `webhook_url` | Worker memanggil host internal | URL hanya diisi owner lewat admin (Fase 6); belum ada validasi host khusus | Tertunda (belum ada input eksternal) |
| Data pribadi di log | Kebocoran nama/email | Log hanya memuat merchant order id, kode error, dan ringkasan cron | Ada |
| Panel admin terekspos | Aksi admin tanpa izin | `/admin/*` wajib Bearer `ADMIN_TOKEN` (dibandingkan waktu-konstan, fail closed bila kosong); panel login token di sessionStorage | Ada + test; live |
| Dependency rentan | RCE/data leak | `pnpm audit` bersih per 2026-11-03; jalankan sebelum rilis | Ada (manual) |
| Secret masuk repo | Kredensial bocor | `.dev.vars`/`.env` di-.gitignore; secret produksi lewat `wrangler secret put`; config gitleaks tersedia | Ada + config |
| Log webhook tumbuh tanpa batas | Kuota D1 penuh | Retensi 30 hari untuk baris `DELIVERED`/`DEAD`; retry terjadwal tidak dipangkas | Ada + test |

## Checklist rilis

- [x] Input divalidasi di batas sistem (Zod, `.strict()`).
- [x] Query parameterized, bukan konkatenasi string.
- [x] API key/secret disimpan sebagai hash atau secret Worker, tidak di-log.
- [x] Otorisasi dicek di server; project hanya membaca transaksinya sendiri.
- [x] Callback diverifikasi signature dan nominal sebelum status diubah.
- [x] Webhook keluar ditandatangani HMAC + timestamp.
- [x] Data pribadi tidak masuk log/error.
- [x] Test jalur gagal (signature salah, nominal salah, akses ditolak, order tak dikenal, retry DEAD).
- [x] `pnpm audit` bersih sebelum deploy staging (2026-11-03).
- [ ] Rate limit per project (FR-10, P1) — belum; andalkan Cloudflare/WAF sebelum produksi.
- [x] Endpoint `/admin/*` dilindungi token Bearer; panel tidak menyimpan token di localStorage/URL.
- [ ] Rate limit percobaan token admin — belum; token 64 hex + WAF disarankan.
- [x] Rotasi API key dan webhook secret lewat panel; kredensial tampil sekali.
- [x] Aksi admin dicatat di `admin_audit` (email pelaku, aksi, target).
- [ ] Pemindaian secret otomatis di CI — config ada, CI belum dipasang.

## Catatan operasional

- Secret staging saat ini **placeholder** (`D0001` / `placeholder-api-key`) untuk menguji callback; ganti dengan kredensial sandbox Duitku asli sebelum uji transaksi nyata.
- Jangan menurunkan `sensitive`/menaikkan `exposure` tanpa meninjau ulang dokumen ini.
