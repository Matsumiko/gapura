# Duitku API v2 — kontrak lengkap

Sumber: https://docs.duitku.com/api/id/ (diakses 2026-11-03). Dokumen ini mencatat bagian yang relevan untuk Gapura; untuk teks resmi selalu rujuk vendor.

## Host

| Lingkungan | Base URL |
|---|---|
| Sandbox | `https://sandbox.duitku.com` |
| Produksi | `https://passport.duitku.com` |

Endpoint (relatif ke base):

- `POST /webapi/api/merchant/paymentmethod/getpaymentmethod`
- `POST /webapi/api/merchant/v2/inquiry`
- `POST /webapi/api/merchant/transactionStatus`

## Signature (HMAC-SHA256, hex lowercase)

| Proses | stringToSign | Catatan |
|---|---|---|
| Get payment method | `merchantcode + amount + datetime` | Field request memakai huruf kecil `merchantcode` |
| Inquiry | `merchantCode + merchantOrderId + paymentAmount` | Urutan ini penting |
| Callback | `merchantCode + amount + merchantOrderId` | `amount` = string mentah dari form |
| Cek transaksi | `merchantCode + merchantOrderId` | |

`signature = HMAC_SHA256(stringToSign, apiKey)`. MD5/SHA-256 lama sudah obsolete sejak perubahan April 2026 (lihat changelog vendor).

## Get payment method (opsional, disarankan)

Request `application/json`:

```json
{
  "merchantcode": "DXXXX",
  "amount": 10000,
  "datetime": "2022-01-25 16:23:08",
  "signature": "..."
}
```

- `datetime` format `yyyy-MM-dd HH:mm:ss` (waktu server pengirim).
- `amount` integer tanpa desimal.

Response:

```json
{
  "paymentFee": [
    {
      "paymentMethod": "VA",
      "paymentName": "MAYBANK VA",
      "paymentImage": "https://images.duitku.com/hotlink-ok/VA.PNG",
      "totalFee": "0"
    }
  ],
  "responseCode": "00",
  "responseMessage": "SUCCESS"
}
```

`totalFee` berupa string. Gunakan endpoint ini untuk menampilkan channel yang benar-benar aktif di merchant beserta biayanya; jangan mengandalkan tabel statis.

## Inquiry (buat transaksi)

`POST /webapi/api/merchant/v2/inquiry`, `application/json`.

### Parameter wajib

| Parameter | Tipe | Keterangan |
|---|---|---|
| `merchantCode` | string(50) | Kode merchant Duitku |
| `paymentAmount` | integer | Nominal; minimum Rp10.000; tanpa desimal |
| `paymentMethod` | string(2) | Kode channel, lihat `duitku-payment-methods.md` |
| `merchantOrderId` | string(50) | **Maksimal 50 karakter**, unik |
| `productDetails` | string(255) | Deskripsi produk |
| `email` | string(255)* | Email pelanggan (vendor juga menyebut batas 50 di daftar error) |
| `customerVaName` | string(20) | Nama pada halaman konfirmasi bank; wajib untuk channel tertentu |
| `returnUrl` | string(255) | Redirect setelah pembayaran |
| `callbackUrl` | string(255) | URL callback Gapura |
| `signature` | string(255) | HMAC sesuai tabel di atas |

### Parameter opsional

| Parameter | Tipe | Keterangan |
|---|---|---|
| `additionalParam` | string(255) | Dikembalikan di callback |
| `merchantUserInfo` | string(255) | ID user di sistem merchant |
| `phoneNumber` | string(50) | Nomor telepon pelanggan |
| `expiryPeriod` | int (menit) | Default per channel, lihat tabel expiry |
| `itemDetails` | array | `{name, price, quantity}`; total harus sama dengan `paymentAmount` |
| `customerDetail` | object | `firstName`, `lastName`, `email`, `phoneNumber`, `billingAddress`, `shippingAddress` |
| `accountLink` | object | Wajib untuk `OL` (OVO) dan `SL` (ShopeePay link); butuh `credentialCode` dari Duitku |
| `creditCardDetail` | object | `acquirer` (`014` BCA, `022` CIMB), `binWhitelist` maks 25 |

`itemDetails`: bila dikirim dan total `price × quantity` tidak sama dengan `paymentAmount`, Duitku membalas 409 `Payment amount must be equal to all item price`. Gapura saat ini tidak mengirim `itemDetails`, jadi tidak terkena aturan ini.

### Response sukses

| Field | Tipe | Keterangan |
|---|---|---|
| `merchantCode` | string | Kode merchant |
| `reference` | string(255) | Referensi Duitku; simpan |
| `paymentUrl` | string(255) | Halaman pembayaran Duitku |
| `vaNumber` | string(20) | Nomor VA (bila channel VA) |
| `qrString` | string(255) | Payload QRIS (bila channel QRIS) |
| `appUrl` | string | Deep link e-commerce/e-wallet tertentu |
| `amount` | integer | Nominal |
| `statusCode` | string | `00` sukses |
| `statusMessage` | string | Pesan |

Gapura menyimpan `reference`, `paymentUrl`, `vaNumber`, `qrString`; `appUrl` belum disimpan.

## Callback Duitku → Gapura

`POST` `application/x-www-form-urlencoded` ke `callbackUrl` yang dikirim saat inquiry.

| Parameter | Keterangan |
|---|---|
| `merchantCode` | Kode merchant |
| `amount` | Nominal (string) |
| `merchantOrderId` | Order ID yang dikirim Gapura (`PREFIX-orderId`) |
| `productDetail` | Deskripsi |
| `additionalParam` | Nilai yang dikirim saat inquiry |
| `paymentCode` | Kode channel |
| `resultCode` | `00` sukses, `01` gagal |
| `merchantUserId` | ID user merchant (bila dikirim) |
| `reference` | Referensi Duitku |
| `signature` | HMAC `merchantCode + amount + merchantOrderId` |
| `publisherOrderId` | ID unik pembayaran dari Duitku |
| `spUserHash` | Ada untuk ShopeePay (QRIS/App/Account Link) |
| `settlementDate` | Estimasi settlement `YYYY-MM-DD` |
| `issuerCode` | Kode issuer QRIS |
| `customerName` | Identitas akun issuer QRIS (sebagian disamarkan) |

Kewajiban penerima:

- Verifikasi signature dengan API key; cocokkan `merchantCode` dan nominal.
- Balas HTTP 200 agar Duitku berhenti mengulang.
- Proses idempotent; callback bisa berulang.

Gapura memetakan `resultCode` `00` → `PAID`, selain itu → `FAILED`, hanya dari status `PENDING`.

## Redirect (kembali ke project)

Duitku mengarahkan pembeli ke `returnUrl`:

```
GET <returnUrl>?merchantOrderId=...&resultCode=...&reference=...
```

`resultCode`: `00` sukses, `01` pending, `02` canceled. Ini hanya untuk tampilan; status resmi tetap dari callback/sinkronisasi.

## Cek transaksi

`POST /webapi/api/merchant/transactionStatus`, `application/json`:

```json
{ "merchantCode": "DXXXX", "merchantOrderId": "abcde12345", "signature": "..." }
```

Response: `merchantOrderId`, `reference`, `amount`, `fee`, `statusCode`, `statusMessage`.

`statusCode`: `00` sukses, `01` pending, `02` canceled. Gapura memetakan `00` → `PAID`, `02` → `EXPIRED`, `01` → tidak berubah.

## HTTP code vendor

| HTTP | Pesan | Arti |
|---|---|---|
| 200 | SUCCESS | Berhasil |
| 400 | Minimum Payment 10000 IDR | Nominal < Rp10.000 |
| 400 | Maximum Payment exceeded | Melebihi batas merchant |
| 400 | paymentMethod is mandatory | `paymentMethod` kosong |
| 400 | merchantOrderId is mandatory | Order ID kosong |
| 400 | length of merchantOrderId can't > 50 | Order ID > 50 |
| 400 | Invalid Email Address | Email tidak valid |
| 400 | length of email can't > 50 | Email > 50 (bertentangan dengan tabel 255) |
| 400 | length of phoneNumber can't > 50 | Telepon terlalu panjang |
| 400 | Customer VA Name must not be empty for this payment channel | `customerVaName` wajib untuk channel ini |
| 401 | Wrong signature | Signature salah |
| 404 | Merchant not found | Kode merchant salah |
| 404 | Payment channel not available | Channel belum aktif di merchant |
| 409 | Payment amount must be equal to all item price | Total `itemDetails` tidak sama |

## Yang dipakai Gapura vs belum

| Fitur vendor | Status Gapura |
|---|---|
| Inquiry + signature HMAC | Dipakai |
| Callback + verifikasi signature/nominal | Dipakai |
| Cek transaksi + Cron pending sync | Dipakai |
| `getPaymentMethod` | Dipakai lewat `GET /v1/payment-methods`, cache 5 menit per nominal |
| `expiryPeriod` | Dipakai opsional; divalidasi 1–10080 menit dan batas maksimum channel |
| `itemDetails`, `customerDetail`, `phoneNumber` | Belum dikirim |
| `accountLink` (OL/SL) | Belum didukung |
| `creditCardDetail` | Dipakai opsional untuk `VC`; `acquirer` 014/022 dan `binWhitelist` maks 25 |
| Fixed VA (SNAP API) | Belum didukung |
| `appUrl` pada response | Belum disimpan |
| Void transaksi | Belum ada (vendor hanya menandai dukungan void untuk OV/SA) |
| Redirect `returnUrl` | Diteruskan dari project |

## Uji coba sandbox

- Kartu kredit 3DS: VISA `4000 0000 0000 0044`, Mastercard `5500 0000 0000 0004`, masa berlaku `03/33`, CVV `123`.
- VA demo sukses: https://sandbox.duitku.com/payment/demo/demosuccesstransaction.aspx
- QRIS/Shopee/Nusapay/Indodana/Atome/Jenius/Tokopedia punya kredensial uji masing-masing di halaman vendor.
- Gapura sudah membuktikan satu siklus nyata di sandbox: inquiry channel `BT`, pembayaran lewat demo VA, lalu callback asli Duitku diterima Gapura (`PAID`) dan diteruskan ke webhook project.

## Cancel, void, dan refund

Diperiksa 2026-11-04.

- **Tidak ada endpoint cancel/void di API v2.** Postman collection resmi hanya berisi lima request: `getpaymentmethod`, `v2/inquiry`, callback (contoh), redirect (contoh), dan `transactionStatus`. Probe ke `/webapi/api/merchant/transaction/delete` dan `/webapi/api/merchant/v2/void` di sandbox menghasilkan HTTP 404.
- **Transaksi belum dibayar** berakhir lewat `expiryPeriod` (atau default channel). FAQ Duitku menyebut merchant dapat mengubah dynamic VA menjadi expired dan fixed VA menjadi inactive; cara yang didokumentasikan adalah lewat dashboard/CS, bukan API publik.
- **Tabel channel** menandai `OV` dan `SA` sebagai "Support Void". Itu kapabilitas channel, bukan janji endpoint API; tidak ada request void yang didokumentasikan.
- **Refund bukan layanan Duitku.** FAQ: "Duitku belum menyediakan layanan refund transaksi; seluruh proses refund ditangani merchant." SNAP API punya `Debit Payment Refund` (`/merchant/debit/v1.0/debit/refund`) untuk transaksi jalur SNAP, bukan API v2 yang dipakai Gapura.
- Klaim SDK komunitas tentang `merchant/transaction/delete` dengan signature MD5 tidak dipakai: anchor dokumentasinya tidak ada, PR tidak di-merge, dan MD5 sudah obsolete.

Implikasi untuk Gapura: belum ada endpoint cancel. Jangan menandai transaksi batal secara lokal tanpa konfirmasi vendor, karena pembeli masih bisa membayar dan callback `PAID` akan datang. Cara aman: `expiryPeriod` pendek + biarkan sinkronisasi `02` memetakan ke `EXPIRED`.
