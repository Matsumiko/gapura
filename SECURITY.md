# Security Policy

Gapura memproses transaksi pembayaran dan data pembeli (nama, email). Jangan pernah membuka issue publik yang memuat detail celah, kredensial, atau data transaksi.

## Melaporkan celah

Laporkan secara privat ke owner repositori (lihat penulis commit / profil pemilik repo). Sertakan:

- endpoint atau komponen yang terdampak,
- langkah reproduksi tanpa data pribadi nyata,
- dampak yang mungkin terjadi.

Jangan menyertakan API key, secret Duitku, atau data pembeli asli dalam laporan maupun tangkapan layar.

## Cakupan

- Worker API: `POST /v1/payments`, `GET /v1/payments/:orderId`, `GET /v1/me`, `POST /callback/duitku`.
- Autentikasi API key project dan isolasi data antar project.
- Verifikasi callback Duitku dan signature webhook keluar.
- Konfigurasi D1 dan secret Worker.

## Di luar cakupan

- Halaman pembayaran Duitku (milik vendor).
- Panel admin dideploy di Cloudflare Pages dan dilindungi token admin (`ADMIN_TOKEN`), bukan Zero Trust; API `/admin/*` menolak request tanpa Bearer token.
- Serangan pada akun Cloudflare atau akun Duitku itu sendiri.

## Target respons

Proyek ini dikelola satu orang; laporan ditinjau sebaik mungkin tanpa SLA. Perbaikan yang menyentuh jalur pembayaran diverifikasi dengan test dan smoke sebelum dirilis.
