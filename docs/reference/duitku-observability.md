# Observability baseline (tanpa layanan berbayar)

Dokumen ini mencatat sinyal yang **sudah** dipancarkan Worker, apa yang perlu dipantau, di mana melihatnya, dan kapan harus bertindak. Semua yang disebut di sini tersedia di Cloudflare plan Free; tidak ada Logpush, Tail Worker, APM, atau layanan berbayar lain yang diasumsikan.

## 1. Aktifkan log persisten

`wrangler.toml` belum memuat blok observability. Tambahkan (sekali, lalu deploy):

```toml
[observability]
enabled = true
head_sampling_rate = 1
```

Batas Workers Logs Free: **200.000 log event/hari, retensi 3 hari**. Dashboard: **Workers & Pages → gapura-sandbox → Observability**. Log real-time tanpa retensi: `cd apps/worker && wrangler tail gapura-sandbox` (bisa difilter `--search`, `--status`, `--method`).

Satu Worker melayani sandbox dan production; bedakan lewat URL invocation (`/sandbox/...` vs `/production/...`). Log aplikasi sendiri tidak selalu memuat environment.

## 2. Sinyal yang sudah dipancarkan

| Sinyal | Bentuk persis | Sumber | Arti |
|---|---|---|---|
| `unhandled_error` | `unhandled_error <message>` (console.error) | `app.onError` | Route melempar error tak tertangani → response `500 INTERNAL` |
| `cron_done` | `cron_done [{"environment":"sandbox","status":"fulfilled","value":{...}}, {...}]` | handler `scheduled` | Cron selesai; satu entri per environment |
| `cron_failed` | `cron_failed <message>` | handler `scheduled` | `Promise.allSettled` itu sendiri gagal (jarang; kegagalan per environment muncul sebagai `status: "rejected"` di `cron_done`) |
| `webhook_forward_failed` | `webhook_forward_failed <merchantOrderId> <message>` | route callback | Pengiriman webhook pertama setelah callback gagal; retry diserahkan ke Cron |
| Invocation log | method, URL, status respons, metadata Cloudflare | Workers Logs (otomatis) | Satu baris per request; sumber utama untuk status HTTP |

`value` pada `cron_done` adalah `CronReport`:

```json
{
  "retries": { "due": 0, "attempted": 0, "delivered": 0, "failed": 0, "dead": 0 },
  "sync": { "checked": 0, "updated": 0, "failed": 0 },
  "pruned": 0
}
```

`status: "rejected"` berisi alasan sebagai string.

### Yang belum dipancarkan (gunakan invocation log)

- Tidak ada log aplikasi untuk `400`, `401`, `409`, `502`, `503` — termasuk **callback signature failure** (`401 INVALID_SIGNATURE`) dan kegagalan create payment.
- Tidak ada request ID atau environment di `unhandled_error`/`webhook_forward_failed`.
- Transisi webhook ke `DEAD` hanya tersimpan di D1, tidak dilog.
- Tidak ada log `PAID`/status transaksi.

Jangan menambah data pribadi ke log. Jangan pernah mencatat `credentialCode` account link, API key project/merchant, email, atau isi callback.

## 3. Apa yang dipantau, di mana, dan kapan bertindak

| # | Kejadian | Sinyal & tempat | Ambang usulan | Tindakan pertama |
|---|---|---|---|---|
| 1 | Create payment 5xx | Filter Observability: status `500` pada path `/v1/payments`; cari `unhandled_error`. Workers & Pages → Metrics → Errors | Ada `500` dalam 5 menit, atau error rate >1% dari request create dalam 15 menit | `wrangler tail` untuk pesan; cek D1 quota; korelasi dengan versi deploy terakhir → rollback bila perlu |
| 2 | Callback signature failure | Invocation log status `401` pada path `/callback/duitku` (tidak ada log aplikasi) | >5 dalam 15 menit, atau berulang terus | Pastikan environment aktif dan merchant code cocok; cek `activeEnvironment` di panel; jangan langsung memblokir path |
| 3 | Webhook dead-letter / backlog | D1: `SELECT status, COUNT(*) FROM webhook_logs GROUP BY status;` dan `cron_done` → `retries.dead`/`retries.failed` | Ada baris `DEAD` baru, atau `FAILED` > 20 | Ikuti RUNBOOK bagian webhook; hubungi pemilik project; kirim ulang setelah endpoint diperbaiki |
| 4 | Cron tidak jalan / gagal | `cron_done` tiap menit; `status: "rejected"`; `cron_failed` | Tidak ada `cron_done` 2 menit berturut-turut, atau ada `rejected` | Cek Triggers Worker (`* * * * *`), cek error D1/provider di `value`, rollback bila deploy-related |
| 5 | Kuota D1 | Workers & Pages → D1 → pilih database → Metrics → Row Metrics; error query muncul sebagai `500` + `unhandled_error` | >80% dari batas harian Free (per akun): 5 juta rows read, 100.000 rows written; storage akun >4 GB dari 5 GB; database tunggal mendekati 500 MB (batas per database di Free) | Kurangi query (panel/cron), jalankan retensi, hentikan pekerjaan non-esensial; upgrade plan hanya bila disetujui |

Batas D1 Free berlaku sejak 1 September 2026: begitu batas harian terlampaui, query **gagal** hingga reset 00:00 UTC. Rows read/written dihitung **per akun** (gabungan semua database), sedangkan storage dijumlah per akun dan dibatasi 500 MB per database. Karena itu kuota D1 adalah alert produksi, bukan sekadar biaya.

Catatan tambahan: Free plan membatasi **50 query D1 per invocation Worker**. Cron memakai batch 10 retry + 10 sync + query retensi, jadi masih di bawah batas; menaikkan `batchSize` tanpa menghitung query per item bisa memicu `Too many API requests by single Worker invocation` dan muncul sebagai `cron_done` dengan `status: "rejected"`.

## 4. Cara memeriksa (perintah siap pakai)

```sh
# Log real-time; Ctrl+C untuk berhenti
cd apps/worker && wrangler tail gapura-sandbox

# Hanya error
wrangler tail gapura-sandbox --status error

# Cari event aplikasi tertentu
wrangler tail gapura-sandbox --search cron_done
wrangler tail gapura-sandbox --search unhandled_error
```

```sh
# Backlog webhook (hitung pemakaian rows read; jalankan secukupnya)
wrangler d1 execute gapura-sandbox --remote --json --command \
  "SELECT status, COUNT(*) AS jumlah FROM webhook_logs GROUP BY status"

# Dead-letter terbaru
wrangler d1 execute gapura-sandbox --remote --json --command \
  "SELECT merchant_order_id, attempt, http_status, error, created_at
     FROM webhook_logs WHERE status = 'DEAD' ORDER BY id DESC LIMIT 20"

# Transaksi PENDING yang menua (indikasi sync/callback bermasalah)
wrangler d1 execute gapura-sandbox --remote --json --command \
  "SELECT merchant_order_id, payment_method, created_at
     FROM transactions WHERE status = 'PENDING'
       AND created_at < datetime('now', '-2 hours') ORDER BY id DESC LIMIT 20"
```

Ganti `gapura-sandbox` dengan `gapura-production` untuk production. Query manual tetap dihitung sebagai rows read/written.

## 5. Dashboard, notifikasi, dan WAF

- **Workers & Pages → Observability**: log persisten (retensi 3 hari) dan filter berdasarkan status/path.
- **Workers & Pages → Metrics**: request, error, subrequest, CPU. Tidak ada alert threshold bawaan untuk Workers di plan Free.
- **D1 → Metrics → Row Metrics**: pemakaian rows read/written dan storage per database.
- **Notifications → Platform Notifications**: tipe alert traffic (Advanced/Origin Error Rate) hanya tersedia untuk Enterprise, jadi **jangan diandalkan**. Tidak ada alert Workers/D1 khusus di Free. Pengganti tanpa biaya: pemeriksaan harian manual (10 menit) memakai perintah di atas, dan opsional uptime monitor gratis eksternal yang memanggil `GET /health` tiap 5 menit.
- **WAF / Security Analytics** (tersedia di Free, Security Events sampled): pantau lonjakan `401`/`403` ke `/admin/*` dan `/v1/*`. Rate limiting Free hanya 1 rule; bila dipakai, arahkan ke `/admin/*` atau `/callback/*` dengan hati-hati — **jangan** memblokir callback Duitku yang sah.

## 6. Rutinitas harian (10 menit)

1. Buka Observability, filter `unhandled_error` dan status `500` 24 jam terakhir.
2. Hitung `webhook_logs` per status; catat jumlah `DEAD`/`FAILED` baru.
3. Pastikan `cron_done` muncul konsisten (log 1 menit terakhir) dan tidak ada `rejected`.
4. Cek D1 Row Metrics ketiga database terhadap batas harian.
5. Cek transaksi `PENDING` yang lebih tua dari 2 jam; sinkronisasi Cron seharusnya menutupnya.
6. Catat temuan di catatan operasi; eskalasi ke owner bila ada poin 3/4/5 yang tidak normal.

## 7. Keterbatasan yang disadari

- Retensi log 3 hari: investigasi insiden lebih lama harus mengandalkan D1 (`transactions`, `webhook_logs`) dan bukti eksternal.
- Log aplikasi belum berformat JSON; Workers Logs mengindeks sebagai teks pesan. Bila volume naik, ubah `console.*` menjadi objek JSON `{ event, environment, ... }` — perubahan kode, bukan prasyarat dokumen ini.
- Panel admin dan Cron memakai D1 yang sama dengan transaksi; lonjakan query panel ikut memakan kuota harian.
