<div align="center">

# ⛩️ G A P U R A ⛩️

### ✧･ﾟ: *✧･ﾟ:* 　Satu Gerbang, Banyak Project　 *:･ﾟ✧*:･ﾟ✧

**Gerbang pembayaran yang memegang satu akun merchant Duitku untuk banyak project.**
Project cuma ngobrol sama Gapura. Kredensial Duitku? Rahasia, nggak pernah dibagi (｡•̀ᴗ-)✧

<br>

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![D1](https://img.shields.io/badge/Database-D1-FF9EC7?style=for-the-badge&logo=sqlite&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-API-E36002?style=for-the-badge&logo=hono&logoColor=white)
![React](https://img.shields.io/badge/Panel-React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A5%2022-A78BFA?style=for-the-badge&logo=nodedotjs&logoColor=white)

`💳 Duitku` ･ `🔐 HMAC-SHA256` ･ `🌸 Multi-Project` ･ `🌙 Sandbox & Production`

</div>

---

> ### 🌸 Catatan Cakupan Deployment
> Contoh di repo ini memakai **Cloudflare Workers + D1** dan dioptimalkan untuk project/bisnis **kecil–menengah** dengan volume transaksi yang wajar. Cloudflare tetap bisa diskalakan, tapi ada batas yang perlu diketahui: CPU per invocation, kuota dan latensi D1, serta Cron minimum satu menit.
>
> - 🌱 Untuk produksi yang lebih serius, pakai **Workers Paid** dulu.
> - 🚀 Kalau volume, kebutuhan proses long-running, atau kepatuhan sudah di luar pola itu, pertimbangkan **self-host** di VPS/Kubernetes dengan PostgreSQL/Redis.
> - ⚠️ Self-host bukan sekadar pindah host: lapisan database, scheduler, dan deployment perlu diganti.

📜 Keputusan arsitektur: [`docs/adr`](docs/adr)

---

## 📖 Daftar Chapter

| # | Chapter | # | Chapter |
|---|---|---|---|
| 1 | [🖼️ Preview](#️-chapter-1--preview) | 8 | [🪝 Webhook Keluar](#-chapter-8--webhook-keluar) |
| 2 | [✨ Fitur](#-chapter-2--fitur) | 9 | [🔄 Retry & Sinkronisasi](#-chapter-9--retry--sinkronisasi) |
| 3 | [🌸 Status](#-chapter-3--status) | 10 | [🧪 Test & Verifikasi](#-chapter-10--test--verifikasi) |
| 4 | [🗂️ Struktur](#️-chapter-4--struktur) | 11 | [🚢 Deploy](#-chapter-11--deploy) |
| 5 | [🎒 Prasyarat & Setup](#-chapter-5--prasyarat--setup) | 12 | [🛡️ Keamanan](#️-chapter-12--keamanan) |
| 6 | [⚔️ API](#️-chapter-6--api) | 13 | [📚 Referensi Duitku](#-chapter-13--referensi-duitku) |
| 7 | [🎛️ Panel Admin](#️-chapter-7--panel-admin) | 14 | [🤝 Bekerja dengan Pakem](#-chapter-14--bekerja-dengan-pakem) |

---

## 🖼️ Chapter 1 — Preview

> Panel admin dengan data demo. Tidak ada kredensial atau data produksi di screenshot (⁠´⁠∩⁠｡⁠• ᵕ •⁠｡⁠∩⁠`⁠)

<div align="center">

<img src="preview/dashboard-light.png" alt="Dashboard Gapura: ringkasan pendapatan, komposisi project, transaksi terbaru, dan antrean webhook" width="100%">

<sub>✦ Dashboard — ringkasan pendapatan, komposisi project, transaksi terbaru, antrean webhook ✦</sub>

</div>

<br>

| 💸 Transaksi | 📁 Project |
|---|---|
| ![Daftar transaksi dengan filter project dan status](preview/transactions.png) | ![Daftar project, prefix, webhook, dan aksi kredensial](preview/projects.png) |

| 👤 Akun | 🔑 Sesi |
|---|---|
| ![Pengaturan akun: email, password, recovery code](preview/account.png) | ![Sesi admin dengan IP, user agent, dan reauth](preview/sessions.png) |

| 📜 Audit | 🌙 Tema Gelap |
|---|---|
| ![Audit aksi admin](preview/audit.png) | ![Dashboard tema gelap](preview/dashboard-dark.png) |

---

## ✨ Chapter 2 — Fitur

| | Kemampuan | Penjelasan |
|---|---|---|
| ⛩️ | **Satu API, banyak project** | Tiap project punya prefix order dan API key sendiri. Kredensial Duitku tidak dibagikan. |
| 🔁 | **Pembuatan pembayaran idempoten** | Retry dengan `orderId`, `amount`, dan `paymentMethod` yang sama mengembalikan transaksi lama, tanpa invoice ganda. |
| 🛡️ | **Callback aman** | Signature HMAC-SHA256, verifikasi nominal, transisi status sekali jalan, lalu webhook bertanda tangan ke project. |
| 📮 | **Webhook andal** | Retry berjadwal, dead-letter, kirim ulang dari panel, dan sinkronisasi transaksi `PENDING` lewat Cron. |
| 🌗 | **Dua environment** | `/sandbox` dan `/production` memakai D1 terpisah. Kredensial Duitku disimpan terenkripsi per environment. |
| 🔐 | **Admin yang aman** | Sesi opaque + TOTP, RBAC owner/admin/viewer, CSRF, step-up reauth, recovery code, dan audit. |
| 🎛️ | **Panel operasional** | Dashboard, project, transaksi, webhook, pengaturan kredensial, akun, sesi, admin, audit, dan referensi API in-app. |

---

## 🌸 Chapter 3 — Status

Berjalan di **Cloudflare Workers + D1**. Dua environment (`/sandbox` dan `/production`) memakai database terpisah, sedangkan admin auth memakai satu database bersama. Panel React tersedia untuk operasi admin.

Jalankan ini untuk memastikan typecheck, test, build panel, dan bundel Worker lolos:

```sh
pnpm verify
```

---

## 🗂️ Chapter 4 — Struktur

```
📦 gapura
 ┣ 🌩️ apps/worker      Worker Hono + migrasi D1 (satu-satunya pemegang kredensial Duitku)
 ┣ 🎨 apps/panel       SPA React (Vite) untuk panel admin
 ┗ 🧩 packages/shared  kode bersama: crypto, hmac, order id, status, skema Zod
```

---

## 🎒 Chapter 5 — Prasyarat & Setup

### 🍙 Prasyarat

- Node.js `>= 22`
- pnpm 12 (`corepack enable pnpm` bila belum ada)
- Akun Cloudflare dengan Workers + D1 (untuk deploy; dev lokal tidak perlu akun)
- Akun merchant Duitku (sandbox/production) untuk transaksi nyata

### 🌱 Setup

```sh
pnpm install

# Konfigurasi Worker lokal
cp apps/worker/wrangler.toml.example apps/worker/wrangler.toml
cp .env.example apps/worker/.dev.vars
# edit apps/worker/.dev.vars: isi DUITKU_MERCHANT_CODE, DUITKU_API_KEY,
# CREDENTIALS_KEY (openssl rand -base64 32), ADMIN_SETUP_TOKEN (openssl rand -hex 32)

# Konfigurasi panel lokal
cp apps/panel/.env.example apps/panel/.env.local

# Skema D1 lokal
pnpm --filter @gapura/worker db:migrate:local
```

`apps/worker/wrangler.toml` dan semua file `.env`/`.dev.vars` diabaikan Git; hanya file `.example` yang dilacak.

Untuk deploy, buat **tiga** database D1 dan ganti `database_id` di `wrangler.toml`:

```sh
cd apps/worker
wrangler login
wrangler d1 create gapura-auth
wrangler d1 create gapura-sandbox
wrangler d1 create gapura-production
```

> 🔑 `CREDENTIALS_KEY` wajib untuk enkripsi kredensial Duitku dan secret TOTP admin.
> 🎫 `ADMIN_SETUP_TOKEN` hanya dipakai **sekali** untuk membuat owner pertama. Hapus secret itu setelah bootstrap.

### ▶️ Jalankan

```sh
# API (terminal 1)
pnpm --filter @gapura/worker dev                # http://127.0.0.1:8787

# Panel (terminal 2)
pnpm --filter @gapura/panel dev                 # http://127.0.0.1:5173
```

Buka panel, isi setup token + email + password, lalu daftarkan secret TOTP. Setelah owner aktif, buat project pertama dari halaman **Project**. API key hanya ditampilkan **sekali**, jadi simpan baik-baik (๑˃ᴗ˂)ﻭ

---

## ⚔️ Chapter 6 — API

`{env}` adalah `sandbox` atau `production`; path lama tanpa prefix diperlakukan sebagai sandbox. Semua endpoint `/v1/*` memakai header `X-Gapura-Key` (API key project). Error selalu berbentuk:

```json
{"error":{"code":"...","message":"..."}}
```

### 🗡️ Daftar Endpoint

| Endpoint | Fungsi |
|---|---|
| `GET /health` | status Worker, tanpa auth |
| `GET /{env}/v1/me` | identitas project pemilik API key |
| `POST /{env}/v1/payments` | buat transaksi Duitku, simpan `PENDING`, kembalikan `paymentUrl`/`vaNumber`/`qrString` |
| `GET /{env}/v1/payments/:orderId` | status transaksi milik project sendiri |
| `GET /{env}/v1/payment-methods?amount=` | channel aktif + biaya dari Duitku (cache 5 menit per nominal) |
| `POST /{env}/callback/duitku` | callback Duitku; verifikasi HMAC-SHA256 + nominal, forward asinkron |
| `GET/POST/PATCH/PUT /admin/*` | panel admin; wajib sesi cookie `__Host-gapura_admin` (HttpOnly) + `X-CSRF-Token` untuk write |
| `GET /admin/settings`, `PUT /admin/settings/:env`, `POST /admin/settings/:env/activate`, `POST /admin/settings/:env/test` | kredensial Duitku per environment (terenkripsi) |
| `GET /admin/audit` | jejak aksi admin |

### 🌟 Contoh Request

```sh
curl -X POST http://127.0.0.1:8787/v1/payments \
  -H "X-Gapura-Key: <api-key-project>" \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "INV123",
    "amount": 150000,
    "productDetails": "Paket Premium",
    "customerName": "Budi",
    "email": "budi@example.com",
    "paymentMethod": "VC",
    "returnUrl": "https://project-a.com/thanks"
  }'
```

`paymentMethod` adalah kode 2 karakter Duitku (`VC`, `VA`, `OV`, `DA`, ...). Order ID yang dikirim ke Duitku berbentuk `PREFIX-orderId` dan unik global.

### 🔁 Idempotensi `POST /v1/payments`

Idempoten terhadap `orderId` project:

- ✅ Retry dengan `orderId`, `amount`, dan `paymentMethod` sama mengembalikan transaksi yang sudah ada dengan HTTP `200` + header `Idempotent-Replayed: true`. Tidak ada invoice Duitku baru.
- ❌ Payload berbeda (amount/paymentMethod) untuk `orderId` yang sama ditolak `409 DUPLICATE_ORDER`.
- ⏳ Bila transaksi masih dalam proses pembuatan invoice (`PENDING` tanpa URL/reference), balasannya `409 ORDER_IN_PROGRESS` + `Retry-After: 2`. Ulangi request yang sama.
- 🏁 Status terminal (`PAID`, `FAILED`, `EXPIRED`) dikembalikan apa adanya. Untuk pembayaran baru setelah gagal/kedaluwarsa, pakai `orderId` baru.
- 🧾 `reference` Duitku disimpan untuk jejak dan webhook, **bukan** kunci idempotensi; nilainya baru ada setelah inquiry berhasil.

### 🎀 Field Opsional

Field pelanggan/order lanjutan bersifat **opsional** dan diteruskan apa adanya bila diisi:

| Field | Bentuk |
|---|---|
| `phoneNumber` | string maks. 50 |
| `additionalParam` | string maks. 255; dikembalikan di callback |
| `merchantUserInfo` | string maks. 255 |
| `itemDetails` | array `{name, price, quantity}`; total `price × quantity` wajib sama dengan `amount` |
| `customerDetail` | `{firstName, lastName, email, phoneNumber, billingAddress, shippingAddress}`; alamat berisi `firstName,lastName,address,city,postalCode,phone,countryCode` |

Tidak ada field yang wajib ditambahkan. Project yang hanya butuh data dasar tetap memakai body lama.

---

## 🎛️ Chapter 7 — Panel Admin

SPA React di `apps/panel` + endpoint `/admin/*` di Worker.

### 🔐 Cara Kerja Login & Sesi

- Login memakai email + password **Argon2id** + kode **TOTP**.
- Worker mengirim token sesi 32 byte lewat cookie `__Host-gapura_admin` (`HttpOnly`, `Secure`, `SameSite=Strict`). D1 hanya menyimpan **hash** token dan hash CSRF.
- Panel tidak menyimpan token sesi di JavaScript. Hanya CSRF token untuk header `X-CSRF-Token` yang disimpan di `sessionStorage`.
- Request baca boleh untuk semua role (`owner`/`admin`/`viewer`); write butuh `owner`/`admin`; aksi sensitif butuh TOTP ulang dalam 15 menit (`reauthenticated_at`).
- Bootstrap owner pertama memakai `ADMIN_SETUP_TOKEN` dan hanya bisa sekali.

```sh
pnpm --filter @gapura/panel dev   # http://127.0.0.1:5173
```

### 🗺️ Halaman

| Halaman | Isi |
|---|---|
| 🌸 **Ringkasan** | dashboard utama |
| 📁 **Project** | buat / edit / aktif / nonaktif / rotasi |
| 💸 **Transaksi** | daftar dan filter transaksi |
| 📮 **Webhook gagal** | pantau dan kirim ulang |
| ⚙️ **Pengaturan** | merchant code + API key sandbox/production (terenkripsi AES-GCM), aktivasi environment, uji kredensial, callback URL |
| 📜 **Audit** | 100 aksi terakhir |
| 📖 **Dokumentasi** | referensi in-app |

Panel menampilkan email + role sesi; role `viewer` melihat data tanpa tombol write. Setiap aksi admin dicatat di tabel `admin_audit` dengan email aktor sesi.

### ☁️ Deploy Panel

Panel dapat dideploy ke **Cloudflare Pages**. Set `VITE_API_URL` dan `VITE_PANEL_URL` saat build. Bila memakai host alias, isi `VITE_CANONICAL_ORIGIN` dan `VITE_ALIAS_HOST` agar panel mengalihkan ke domain kanonik sebelum React dimuat.

| Kondisi | Respons |
|---|---|
| Request admin tanpa sesi | `401` |
| Write tanpa CSRF | `403 CSRF_INVALID` |
| Aksi sensitif dengan reauth kedaluwarsa | `403 REAUTH_REQUIRED` |

Langkah lengkap ada di [`DEPLOYMENT.md`](DEPLOYMENT.md). Detail keputusan: [ADR-0010](docs/adr/0010-admin-auth-sesi-opaque-totp-step-up.md).

---

## 🪝 Chapter 8 — Webhook Keluar

Saat status berubah, Gapura mengirim `POST` JSON ke `webhook_url` project:

```
X-Gapura-Event: payment.status
X-Gapura-Signature: t=<unix-seconds>,v1=<hex>
```

```
v1 = HMAC_SHA256(<t> + "." + <body>, webhook_secret_project)
```

`body` adalah byte JSON persis.

> 📌 Project **wajib** menolak timestamp di luar toleransi (disarankan 5 menit) dan memproses secara idempotent. Respons `2xx` dianggap terkirim; selain itu dicatat di `webhook_logs` dengan jadwal retry (pemrosesnya menyusul di tahap retry).

Detail kontrak: [ADR-0004](docs/adr/0004-kontrak-integrasi-duitku-v2-dan-webhook-keluar.md)

---

## 🔄 Chapter 9 — Retry & Sinkronisasi

Cron Trigger berjalan tiap menit (`[triggers]` di `wrangler.toml`) dan mengerjakan dua hal:

**① 📮 Retry webhook**
Baris `FAILED` yang `next_attempt_at`-nya sudah lewat diklaim, dikirim ulang, lalu dicatat sebagai percobaan berikutnya.
Jeda: `1m → 5m → 15m → 1j → 6j`. Percobaan ke-8 yang gagal menjadi `DEAD`.
Pengiriman *at-least-once*, jadi project wajib idempotent.

**② 🔍 Sinkronisasi pending**
Transaksi `PENDING` lebih dari 10 menit dicek ke Duitku (`transactionStatus`):

| Kode | Hasil |
|---|---|
| `00` | → `PAID` |
| `02` | → `EXPIRED` |
| `01` | → tetap |

Hanya perubahan yang diteruskan ke webhook.

🧹 Riwayat `DELIVERED`/`DEAD` lebih tua dari 30 hari dipangkas otomatis; `FAILED` yang masih terjadwal tidak disentuh.

Detail: [ADR-0005](docs/adr/0005-retry-webhook-dan-sinkronisasi-status-via-cron.md)

Uji Cron lokal:

```sh
pnpm --filter @gapura/worker dev -- --test-scheduled
curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"
```

---

## 🧪 Chapter 10 — Test & Verifikasi

```sh
pnpm verify
```

Menjalankan typecheck semua paket, test `packages/shared` dan `apps/worker`, build panel, dan bundel Worker (`wrangler deploy --dry-run`) tanpa mengunggah apa pun.

Test Worker memakai:

- 🌐 harness HTTP + repository in-memory untuk logika
- 🗃️ SQL asli (`node:sqlite`) untuk repository/migrasi
- 🎭 klien Duitku palsu untuk jalur HTTP vendor

Alasan pilihan ini ada di [ADR-0003](docs/adr/0003-test-memakai-vitest-plus-sqlite-asli-bukan-minifla.md).

---

## 🚢 Chapter 11 — Deploy

Langkah lengkap dan rollback: [`DEPLOYMENT.md`](DEPLOYMENT.md) ･ Triage: [`RUNBOOK.md`](RUNBOOK.md)

Ringkasnya:

1. 🗄️ Isi `database_id` ketiga D1 di `apps/worker/wrangler.toml`.
2. 📦 `wrangler d1 migrations apply <nama-db> --remote` untuk auth, sandbox, dan production.
3. 🌍 Set `PUBLIC_BASE_URL` ke URL Worker, lalu `wrangler deploy`.
4. 🔑 `wrangler secret put` untuk `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`, `CREDENTIALS_KEY`, dan `ADMIN_SETUP_TOKEN`.
5. 🎨 Build panel dengan `VITE_API_URL` yang menunjuk ke Worker, lalu deploy ke Pages.

> 💖 Hanya layanan Cloudflare **free tier** yang dipakai (Workers, D1, Cron Trigger). Tanpa Queues/R2.

---

## 🛡️ Chapter 12 — Keamanan

Repo ini menangani transaksi pembayaran dan data pembeli (nama, email).

- 🚫 Jangan commit secret Duitku, API key project, atau webhook secret.
- 🔒 API key project disimpan sebagai hash SHA-256; key mentah hanya ditampilkan sekali saat dibuat.
- 📨 Laporan celah: [`SECURITY.md`](SECURITY.md)
- 📋 Ancaman dan checklist: [`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md)
- 🔎 Periksa dependency dengan `pnpm security`

---

## 📚 Chapter 13 — Referensi Duitku

Kontrak vendor dipelajari dan dicatat supaya tidak menebak-nebak:

- 📘 [`docs/reference/duitku-api.md`](docs/reference/duitku-api.md): endpoint, signature HMAC, parameter inquiry/callback/cek transaksi, kode error, pemetaan ke Gapura.
- 📗 [`docs/reference/duitku-payment-methods.md`](docs/reference/duitku-payment-methods.md): 32 channel per sistem, expiry, void, account link, channel aktif sandbox, batas nominal/order ID.
- 🤖 Katalog machine-readable: `packages/shared/src/payment-methods.ts` (dipakai panel untuk label channel).

### 📏 Batas yang Ditegakkan Gapura

| Aturan | Batas |
|---|---|
| Nominal minimal (non-QRIS) | Rp10.000 |
| Nominal minimal (QRIS) | Rp5.000 |
| `merchantOrderId` | maks 50 karakter |
| Email | maks 50 karakter |
| `paymentMethod` | 2 karakter |

Opsional: `expiryPeriod` (divalidasi per channel) dan `creditCardDetail` untuk `VC`. Channel aktif + biaya diambil lewat `GET /v1/payment-methods` (cache 5 menit).

---

## 🤝 Chapter 14 — Bekerja dengan Pakem

```sh
python3 .pakem/pakem.py start "<goal>"
python3 .pakem/pakem.py check
python3 .pakem/pakem.py finish --summary "<hasil + bukti>"
```

Routing konteks lengkap: [`.pakem/CONTEXT.md`](.pakem/CONTEXT.md)

---

<div align="center">

```
   ⛩️ ･ﾟ✧  Terima kasih sudah mampir ke Gapura  ✧ﾟ･ ⛩️
```

*Semoga transaksimu lancar, webhook-mu selalu terkirim, dan nggak ada* `DEAD` *di antrean~* ପ(๑•ᴗ•๑)ଓ ♡

</div>
