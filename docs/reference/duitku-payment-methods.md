# Duitku — metode pembayaran, channel, dan batasannya

Sumber: https://docs.duitku.com/api/id/#metode-pembayaran (diakses 2026-11-03), ditambah data `getPaymentMethod` dari akun sandbox `DS24636` pada tanggal yang sama.

## Konsep: sistem vs channel

Duitku tidak menerima "sistem pembayaran" di API. Yang dikirim sebagai `paymentMethod` adalah **kode channel dua karakter** (mis. `BC`, `M2`, `OV`, `VC`). Sistem (Bank Transfer, E-Wallet, Retail, Credit Card, QRIS, PayLater, E-Banking, E-Commerce) hanya pengelompokan untuk tampilan.

- Channel harus **aktif di merchant**. Daftar aktif + biaya diambil lewat `getPaymentMethod`.
- Kode tidak selalu mencerminkan nama: `VA` = Maybank VA, `BT` = Permata VA, `A1` = ATM Bersama.
- Ada channel yang hanya bisa dipakai dengan parameter tambahan: `SL`/`OL` butuh `accountLink.credentialCode`.

## Katalog channel vendor (32 channel)

### Bank Transfer (Virtual Account)

| Kode | Channel | Expiry default | Expiry maks |
|---|---|---|---|
| `BC` | BCA Virtual Account | 1440 menit | > 1440 |
| `M2` | Mandiri Virtual Account | 1440 | > 1440 |
| `VA` | Maybank Virtual Account | 1440 | > 1440 |
| `I1` | BNI Virtual Account | 1440 | > 1440 |
| `B1` | CIMB Niaga Virtual Account | 1440 | > 1440 |
| `BT` | Permata Bank Virtual Account | 1440 | > 1440 |
| `A1` | ATM Bersama | 1440 | > 1440 |
| `AG` | Bank Artha Graha | 1440 | > 1440 |
| `NC` | Bank Neo Commerce / BNC | 1440 | > 1440 |
| `BR` | BRIVA (BRI VA) | 1440 | > 1440 |
| `S1` | Bank Sahabat Sampoerna | 1440 | > 1440 |
| `DM` | Danamon Virtual Account | 1440 | > 1440 |
| `BV` | BSI Virtual Account | 1440 | > 1440 |

Catatan: Fixed VA (nomor VA statis/kustom) tidak lewat API ini; vendor mengarahkan ke SNAP API.

### Retail

| Kode | Channel | Expiry default | Expiry maks |
|---|---|---|---|
| `FT` | Pegadaian / ALFA / Pos | 1440 | > 1440 |
| `IR` | Indomaret | 1440 | > 1440 |

### E-Wallet

| Kode | Channel | Expiry default | Expiry maks | Catatan |
|---|---|---|---|---|
| `OV` | OVO Apps | 10 | 1440 | Dukung void |
| `SA` | ShopeePay Apps | 10 | 60 | Dukung void |
| `LF` | LinkAja Apps | 24 | 1440 | Biaya tetap |
| `LA` | LinkAja Apps | 24 | 1440 | Biaya persentase |
| `DA` | DANA | 1440 | 1440 | |
| `SL` | ShopeePay Account Link | 30 | - | Butuh `accountLink.credentialCode`, `shopee` |
| `OL` | OVO Account Link | 15 | - | Butuh `accountLink.credentialCode`, `ovo` |

Account link: transaksi memakai akun OVO/ShopeePay yang sudah ditautkan. `credentialCode` didapat dari Duitku; untuk OVO wajib `paymentDetails` (`paymentType: CASH`, `amount`), untuk Shopee opsi `useCoin`/`promoId`.

### Credit Card

| Kode | Channel | Expiry default | Catatan |
|---|---|---|---|
| `VC` | Visa / Mastercard / JCB | 30 | 3DS; opsi `acquirer` (`014` BCA, `022` CIMB) dan `binWhitelist` (maks 25) |

### QRIS

| Kode | Channel | Expiry default | Expiry maks |
|---|---|---|---|
| `SP` | ShopeePay QRIS | 10 | 60 |
| `NQ` | Nobu QRIS | 24 | 1440 |
| `SQ` | Nusapay QRIS | tidak tercantum | tidak tercantum |

Response inquiry untuk QRIS mengisi `qrString` (payload yang harus dirender menjadi QR). Callback QRIS dapat membawa `issuerCode`, `settlementDate`, dan `customerName`.

### PayLater

| Kode | Channel | Expiry default | Expiry maks | Catatan |
|---|---|---|---|---|
| `DN` | Indodana Paylater | 1440 | 1440 | Vendor menandai "Kredit*" |
| `AT` | ATOME | 720 | 720 | Vendor menandai "Kredit*" |

### E-Banking

| Kode | Channel | Expiry default | Expiry maks |
|---|---|---|---|
| `JP` | Jenius Pay | 10 | 10 |

### E-Commerce

| Kode | Channel | Expiry default | Expiry maks |
|---|---|---|---|
| `T1` | Tokopedia Card Payment | 1440 | 1440 |
| `T2` | Tokopedia E-Wallet | 1440 | 1440 |
| `T3` | Tokopedia Others | 1440 | 1440 |

## Tabel expiry ringkas dari vendor

| Jenis | Default | Maks |
|---|---|---|
| Credit Card | 30 menit | - |
| Virtual Account | 1440 | > 1440 |
| Retail | 1440 | > 1440 |
| OVO | 10 | 1440 |
| Shopee Pay Apps | 10 | 60 |
| LinkAja Apps | 24 | 1440 |
| DANA | 1440 | 1440 |
| Shopee Pay Account Link | 30 | - |
| OVO Account Link | 15 | - |
| QRIS | 10 | 60 |
| Nobu QRIS | 24 | 1440 |
| Indodana Paylater | 1440 | 1440 |
| ATOME | 720 | 720 |
| Jenius Pay | 10 | 10 |
| Tokopedia | 1440 | 1440 |

Gapura menerima `expiryPeriod` opsional (1–10080 menit), memvalidasinya terhadap batas maksimum channel di tabel ini, lalu meneruskannya ke Duitku. Bila tidak diisi, vendor memakai default di atas.

## Batas dan aturan yang mudah terlewat

| Aturan | Nilai | Konsekuensi bila dilanggar |
|---|---|---|
| Nominal minimum | Rp10.000 | HTTP 400 `Minimum Payment 10000 IDR` |
| `merchantOrderId` | maks 50 karakter | HTTP 400 `length of merchantOrderId can't > 50` |
| `customerVaName` | maks 20 karakter | Dipotong vendor / error untuk channel tertentu |
| `paymentMethod` | kode 2 karakter, harus aktif | HTTP 404 `Payment channel not available` |
| `itemDetails` vs `paymentAmount` | total harus sama | HTTP 409 |
| Email | tabel bilang 255, daftar error bilang 50 | Amannya < 50 karakter |

Gapura sekarang menegakkan minimum Rp10.000 dan `merchantOrderId` ≤ 50 (PREFIX + tanda hubung + orderId) sebelum memanggil Duitku.

## Channel yang aktif di sandbox Gapura (`DS24636`)

Diambil lewat `getPaymentMethod` pada 2026-11-03. Biaya adalah `totalFee` dari vendor, bukan biaya Gapura.

| Kode | Nama vendor | Fee |
|---|---|---|
| `BT` | PERMATA VA | 0 |
| `A1` | ATM BERSAMA VA | 0 |
| `DA` | DANA | 0 |
| `NQ` | NOBU QRIS | 0 |
| `VC` | CREDIT CARD | 2790 |
| `OV` | OVO | 150 |
| `VA` | MAYBANK VA | 3000 |
| `B1` | CIMB NIAGA VA | 3000 |
| `I1` | BNI VA | 3000 |
| `M2` | MANDIRI VA H2H | 3000 |
| `AG` | ARTHA GRAHA VA | 3000 |
| `BC` | BCA VA | 3000 |
| `BR` | BRI VA | 3000 |
| `NC` | BNC VA | 3000 |
| `BV` | BSI VA | 3000 |
| `DN` | INDODANA PAYLATER | 100 |
| `IR` | INDOMARET | 6000 |
| `FT` | RETAIL | 7500 |

Daftar ini bisa berubah kapan saja; selalu ambil ulang dari API.

## Yang perlu diketahui saat memilih channel

- **VA**: response berisi `vaNumber` + `paymentUrl`; nominal harus sama persis.
- **QRIS**: response berisi `qrString`; render sendiri menjadi QR. `NQ`/`SP`/`SQ` beda issuer.
- **E-Wallet account link (`OL`/`SL`)**: tidak bisa dipakai tanpa `accountLink` dari Duitku.
- **Credit card (`VC`)**: 3DS; `creditCardDetail` opsional untuk memilih acquirer (`014` BCA, `022` CIMB) dan whitelist BIN maksimal 25.
- **Retail (`FT`/`IR`)**: pembeli membayar di gerai; expiry default 24 jam.
- **PayLater (`DN`/`AT`)**: butuh akun/limit pelanggan.
- **Void**: docs vendor hanya menandai `OV` dan `SA` "Support Void"; tidak ada endpoint void di API v2 yang didokumentasikan, jadi Gapura belum menyediakannya.

## Bagaimana Gapura memperlakukannya

- Project mengirim `paymentMethod` 2 karakter; Gapura memvalidasi bentuk (`^[A-Z0-9]{2}$`) lalu meneruskannya ke Duitku.
- Gapura **tidak** membatasi ke katalog; channel baru dari vendor tetap bisa dipakai tanpa deploy.
- Katalog `packages/shared/src/payment-methods.ts` dipakai panel untuk menampilkan nama channel (mis. `BC` → "BCA Virtual Account") dan halaman Dokumentasi.
- Channel aktif tidak diambil otomatis. Bila project mengirim channel yang tidak aktif, Duitku membalas 404 dan Gapura mengembalikan `502 PROVIDER_ERROR` (baris PENDING dihapus).
- Rekomendasi berikutnya: endpoint cache `GET /v1/payment-methods` yang membaca `getPaymentMethod`, supaya project bisa menampilkan pilihan channel aktif + biaya tanpa tahu kredensial Duitku.
