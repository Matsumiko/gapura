# DECISIONS

Indeks keputusan arsitektur. Detail tiap keputusan ada di docs/adr/ (buat lewat `python3 .pakem/pakem.py adr "judul"`).
Keputusan yang sudah tercatat tidak diperdebatkan ulang kecuali ada informasi baru; kalau begitu, buat ADR baru yang menggantikan.

## Daftar

- `docs/adr/0001-satu-worker-d1-dan-antrean-untuk-semua-project.md` - Satu Worker, D1, dan antrean untuk semua project
- `docs/adr/0002-retry-webhook-dengan-d1-dan-cron-trigger-tanpa-lay.md` - Retry webhook dengan D1 dan Cron Trigger tanpa layanan berbayar
- `docs/adr/0003-test-memakai-vitest-plus-sqlite-asli-bukan-minifla.md` - Test memakai Vitest plus SQLite asli, bukan Miniflare
- `docs/adr/0004-kontrak-integrasi-duitku-v2-dan-webhook-keluar.md` - Kontrak integrasi Duitku v2 dan webhook keluar
- `docs/adr/0005-retry-webhook-dan-sinkronisasi-status-via-cron.md` - Retry webhook dan sinkronisasi status via Cron
- `docs/adr/0006-admin-api-dan-panel-dilindungi-cloudflare-access-j.md` - Admin API dan panel dilindungi Cloudflare Access JWT
