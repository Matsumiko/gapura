import type { ReactNode } from "react";
import {
  PAYMENT_SYSTEMS,
  channelsBySystem,
  type PaymentChannel,
} from "@gapura/shared/payment-methods";
import { PageHeader } from "../components";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787";
const PANEL_URL = import.meta.env.VITE_PANEL_URL ?? window.location.origin;

const SECTIONS = [
  { id: "mulai", label: "Mulai" },
  { id: "auth", label: "Autentikasi project" },
  { id: "metode-pembayaran", label: "Metode pembayaran" },
  { id: "buat-pembayaran", label: "Buat pembayaran" },
  { id: "cek-status", label: "Cek status" },
  { id: "siklus-status", label: "Siklus status" },
  { id: "webhook", label: "Webhook keluar" },
  { id: "error", label: "Kode error" },
  { id: "panel", label: "Panduan panel" },
  { id: "admin-api", label: "Admin API" },
  { id: "batasan", label: "Batasan & keamanan" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="doc-code">
      <code>{children}</code>
    </pre>
  );
}

function DocTable({ children }: { children: ReactNode }) {
  return (
    <div
      className="doc-table-wrap"
      role="region"
      aria-label="Tabel dokumentasi"
      tabIndex={0}
    >
      {children}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="doc-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function DocsPage() {
  return (
    <>
      <PageHeader
        title="Dokumentasi Gapura"
        lede="Gapura adalah gerbang pembayaran yang memegang satu akun merchant Duitku untuk banyak project. Project hanya berbicara dengan Gapura; kredensial Duitku tidak pernah dibagikan."
      />

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="Daftar isi">
          <p className="docs-toc__title">Daftar isi</p>
          <nav>
            {SECTIONS.map((section) => (
              <a key={section.id} href={`#${section.id}`}>
                {section.label}
              </a>
            ))}
          </nav>
        </aside>

        <article className="docs-content">
          <Section id="mulai" title="Mulai">
          <p>
            Semua endpoint project diawali environment: <code>{API_BASE}/sandbox/v1/...</code> atau{" "}
            <code>{API_BASE}/production/v1/...</code>. Path lama tanpa prefix diperlakukan sebagai
            sandbox.
          </p>
          <p>Dua permukaan yang dipakai:</p>
          <DocTable><table>
            <tbody>
              <tr>
                <th>API project</th>
                <td>
                  <code>{API_BASE}</code>
                </td>
              </tr>
              <tr>
                <th>Panel admin</th>
                <td>
                  <code>{PANEL_URL}</code>
                </td>
              </tr>
            </tbody>
          </table></DocTable>
          <p>Alur satu pembayaran:</p>
          <ol>
            <li>Backend project memanggil <code>POST /v1/payments</code> dengan API key project.</li>
            <li>
              Gapura membentuk order ID <code>PREFIX-orderId</code>, menyimpan transaksi{" "}
              <code>PENDING</code>, lalu membuat invoice ke Duitku.
            </li>
            <li>Pembeli membayar di halaman Duitku (VA, QRIS, e-wallet, kartu, dsb.).</li>
            <li>
              Duitku memanggil satu callback Gapura. Gapura memverifikasi signature dan nominal,
              mengubah status sekali (idempotent), lalu membalas cepat.
            </li>
            <li>
              Gapura meneruskan status ke webhook project, ditandatangani HMAC. Jika gagal,
              Cron mengulang dengan backoff.
            </li>
          </ol>
        </Section>

        <Section id="auth" title="Autentikasi project">
          <p>
            Setiap request <code>/v1/*</code> wajib membawa header <code>X-Gapura-Key</code> berisi
            API key project. Key hanya ditampilkan sekali saat project dibuat atau dirotasi; yang
            disimpan di database hanya hash SHA-256.
          </p>
          <Code>{`curl ${API_BASE}/sandbox/v1/me \\
  -H "X-Gapura-Key: gpk_..."`}</Code>
          <p>
            Project nonaktif ditolak untuk transaksi baru (<code>403 PROJECT_INACTIVE</code>), tetapi
            callback untuk transaksi lama tetap diteruskan.
          </p>
        </Section>

        <Section id="metode-pembayaran" title="Metode pembayaran">
          <p>
            Duitku memisahkan <strong>sistem pembayaran</strong> (Bank Transfer, E-Wallet, Retail,
            Credit Card, QRIS, PayLater, E-Banking, E-Commerce) dari <strong>channel</strong>.
            Gapura meneruskan kode channel dua karakter sebagai <code>paymentMethod</code>; tidak
            ada kode sistem terpisah di API.
          </p>
          <p>
            Channel yang bisa dipakai adalah yang aktif di akun merchant Duitku, bukan seluruh tabel.
            Gapura menyediakan daftar aktif beserta biaya dari{" "}
            <code>getPaymentMethod</code>:
          </p>
          <Code>{`curl "${API_BASE}/v1/payment-methods?amount=150000" \
  -H "X-Gapura-Key: gpk_..."`}</Code>
          <Code>{`{
  "amount": 150000,
  "items": [
    {
      "code": "BC",
      "name": "BCA VA",
      "officialName": "BCA Virtual Account",
      "system": "Bank Transfer",
      "image": "https://images.duitku.com/hotlink-ok/BC.PNG",
      "totalFee": "5000"
    }
  ]
}`}</Code>
          <p>
            Hasil di-cache 5 menit per nominal (biaya bisa bergantung nominal). Kode di luar katalog
            tetap diteruskan dengan <code>system: null</code>. Katalog di bawah adalah referensi
            vendor; sumbernya <code>packages/shared/src/payment-methods.ts</code>.
          </p>
          {PAYMENT_SYSTEMS.map((system) => (
            <div key={system}>
              <h3>{system}</h3>
              <DocTable><table>
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Channel</th>
                    <th>Expiry default / maks</th>
                    <th>Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {channelsBySystem(system).map((channel: PaymentChannel) => (
                    <tr key={channel.code}>
                      <td>
                        <code>{channel.code}</code>
                      </td>
                      <td>{channel.name}</td>
                      <td>
                        {channel.defaultExpiryMinutes === undefined
                          ? "-"
                          : `${channel.defaultExpiryMinutes} menit / ${
                              channel.maxExpiryMinutes === null
                                ? "> default"
                                : channel.maxExpiryMinutes === undefined
                                  ? "-"
                                  : `${channel.maxExpiryMinutes} menit`
                            }`}
                      </td>
                      <td>
                        {[
                          channel.supportsVoid ? "dukung void" : null,
                          channel.requiresAccountLink ? "butuh accountLink" : null,
                          channel.note ?? null,
                        ]
                          .filter(Boolean)
                          .join("; ") || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></DocTable>
            </div>
          ))}
          <p>
            Batas penting: nominal minimal <strong>Rp10.000</strong> (QRIS <strong>Rp5.000</strong>) dan{" "}
            <code>merchantOrderId</code> (PREFIX-orderId) maksimal <strong>50 karakter</strong>.
            Gapura menolak keduanya di awal dengan 400, bukan meneruskannya ke Duitku.
          </p>
        </Section>

        <Section id="buat-pembayaran" title="Buat pembayaran">
          <p>
            <code>POST /v1/payments</code>, body JSON, hanya field di bawah yang diterima (field
            asing ditolak).
          </p>
          <DocTable><table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Aturan</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>orderId</code>
                </td>
                <td>
                  1-128 karakter (ditolak 400 bila PREFIX-orderId &gt; 50), tanpa spasi di awal/akhir.
                  Satu transaksi per <code>orderId</code> project; request ulang dengan payload sama
                  mengembalikan transaksi lama, bukan membuat pembayaran baru.
                </td>
              </tr>
              <tr>
                <td>
                  <code>amount</code>
                </td>
                <td>Integer rupiah, minimal Rp10.000; QRIS minimal Rp5.000. Tanpa desimal.</td>
              </tr>
              <tr>
                <td>
                  <code>productDetails</code>
                </td>
                <td>1-255 karakter.</td>
              </tr>
              <tr>
                <td>
                  <code>customerName</code>
                </td>
                <td>
                  1-255 karakter; Duitku menampilkan 20 karakter pertama.
                </td>
              </tr>
              <tr>
                <td>
                  <code>email</code>
                </td>
                <td>Email valid, maksimal 50 karakter (batas error Duitku; tabel vendor menulis 255).</td>
              </tr>
              <tr>
                <td>
                  <code>paymentMethod</code>
                </td>
                <td>
                  Kode Duitku 2 karakter kapital, mis. <code>VC</code>, <code>VA</code>,{" "}
                  <code>BT</code>, <code>OV</code>, <code>DA</code>, <code>SA</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>returnUrl</code>
                </td>
                <td>URL http/https; pembeli diarahkan ke sini setelah selesai/batal.</td>
              </tr>
              <tr>
                <td>
                  <code>expiryPeriod</code>
                </td>
                <td>
                  Opsional, 1-10080 menit. Tidak boleh melebihi batas channel (mis. QRIS 60 menit);
                  default mengikuti Duitku.
                </td>
              </tr>
              <tr>
                <td>
                  <code>creditCardDetail</code>
                </td>
                <td>
                  Khusus <code>VC</code>: <code>acquirer</code> <code>014</code>/<code>022</code>,
                  <code>binWhitelist</code> 3/6 digit maksimal 25.
                </td>
              </tr>
              <tr>
                <td>
                  <code>phoneNumber</code>
                </td>
                <td>Opsional, maksimal 50 karakter; nomor pelanggan.</td>
              </tr>
              <tr>
                <td>
                  <code>additionalParam</code>
                </td>
                <td>
                  Opsional, maksimal 255 karakter; nilai ini dikembalikan di callback. Cocok untuk ID
                  internal project.
                </td>
              </tr>
              <tr>
                <td>
                  <code>merchantUserInfo</code>
                </td>
                <td>Opsional, maksimal 255 karakter; ID user di sistem project.</td>
              </tr>
              <tr>
                <td>
                  <code>itemDetails</code>
                </td>
                <td>
                  Opsional, array <code>{`{name, price, quantity}`}</code> maksimal 100 item. Total{" "}
                  <code>price × quantity</code> wajib sama dengan <code>amount</code>; bila tidak,
                  request ditolak <code>400</code> sebelum memanggil Duitku.
                </td>
              </tr>
              <tr>
                <td>
                  <code>customerDetail</code>
                </td>
                <td>
                  Opsional: <code>firstName</code>, <code>lastName</code>, <code>email</code>,{" "}
                  <code>phoneNumber</code>, <code>billingAddress</code>,{" "}
                  <code>shippingAddress</code>. Alamat berisi <code>firstName</code>,{" "}
                  <code>lastName</code>, <code>address</code>, <code>city</code>,{" "}
                  <code>postalCode</code>, <code>phone</code>, <code>countryCode</code>.
                </td>
              </tr>
            </tbody>
          </table></DocTable>
          <Code>{`curl -X POST ${API_BASE}/sandbox/v1/payments \\
  -H "X-Gapura-Key: gpk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "orderId": "INV123",
    "amount": 150000,
    "productDetails": "Paket Premium",
    "customerName": "Budi",
    "email": "budi@example.com",
    "paymentMethod": "BT",
    "returnUrl": "https://project-a.com/thanks"
  }'`}</Code>
          <p>Respons 201:</p>
          <Code>{`{
  "merchantOrderId": "PRJA-INV123",
  "projectOrderId": "INV123",
  "amount": 150000,
  "status": "PENDING",
  "paymentMethod": "BT",
  "paymentUrl": "https://sandbox.duitku.com/topup/...",
  "reference": "DS2463...",
  "vaNumber": "868001...",
  "qrString": null,
  "createdAt": "2026-11-03T15:03:32.809Z",
  "updatedAt": "2026-11-03T15:03:33.603Z"
}`}</Code>
          <p>
            Arahkan pembeli ke <code>paymentUrl</code>. <code>vaNumber</code>/<code>qrString</code>{" "}
            hanya terisi sesuai metode. Bila Duitku menolak sebelum transaksi dibuat, baris{" "}
            <code>PENDING</code> dihapus sehingga <code>orderId</code> yang sama boleh dicoba lagi.
          </p>
          <p>
            <strong>Idempoten:</strong> retry dengan <code>orderId</code>, <code>amount</code>, dan{" "}
            <code>paymentMethod</code> yang sama mengembalikan HTTP <code>200</code> +{" "}
            <code>Idempotent-Replayed: true</code> berisi transaksi lama; Duitku tidak dipanggil ulang.
            Payload berbeda ditolak <code>409 DUPLICATE_ORDER</code>. Bila invoice masih dibuat,
            balasan <code>409 ORDER_IN_PROGRESS</code> + <code>Retry-After: 2</code>: ulangi request
            yang sama. Status terminal dikembalikan apa adanya; untuk pembayaran baru gunakan{" "}
            <code>orderId</code> baru. <code>reference</code> Duitku hanya jejak, bukan kunci
            idempotensi.
          </p>
        </Section>

        <Section id="cek-status" title="Cek status">
          <p>
            <code>GET /v1/payments/:orderId</code> mengembalikan transaksi milik project sendiri
            (order project, bukan <code>merchantOrderId</code>). Project lain akan mendapat 404.
          </p>
          <Code>{`curl ${API_BASE}/sandbox/v1/payments/INV123 \\
  -H "X-Gapura-Key: gpk_..."`}</Code>
          <p>
            Gunakan endpoint ini untuk rekonsiliasi manual. Transaksi <code>PENDING</code> yang
            lebih dari 10 menit juga disinkronkan otomatis oleh Cron.
          </p>
        </Section>

        <Section id="siklus-status" title="Siklus status">
          <DocTable><table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Arti</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>PENDING</code>
                </td>
                <td>Menunggu pembayaran.</td>
              </tr>
              <tr>
                <td>
                  <code>PAID</code>
                </td>
                <td>Pembayaran berhasil (resultCode Duitku 00 / statusCode 00).</td>
              </tr>
              <tr>
                <td>
                  <code>FAILED</code>
                </td>
                <td>Callback Duitku melaporkan gagal (resultCode selain 00).</td>
              </tr>
              <tr>
                <td>
                  <code>EXPIRED</code>
                </td>
                <td>Sinkronisasi Duitku melaporkan canceled (statusCode 02).</td>
              </tr>
            </tbody>
          </table></DocTable>
          <p>
            Status hanya maju dari <code>PENDING</code> ke salah satu status akhir, sekali saja.
            Callback berulang tidak mengubah status dan tidak memicu webhook ulang.
          </p>
        </Section>

        <Section id="webhook" title="Webhook keluar">
          <p>
            Saat status berubah, Gapura mengirim <code>POST</code> JSON ke <code>webhook_url</code>{" "}
            project.
          </p>
          <DocTable><table>
            <thead>
              <tr>
                <th>Header</th>
                <th>Nilai</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>Content-Type</code>
                </td>
                <td>
                  <code>application/json</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code>X-Gapura-Event</code>
                </td>
                <td>
                  <code>payment.status</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code>X-Gapura-Signature</code>
                </td>
                <td>
                  <code>t=&lt;unix-seconds&gt;,v1=&lt;hex&gt;</code>
                </td>
              </tr>
            </tbody>
          </table></DocTable>
          <p>
            <code>v1 = HMAC_SHA256(t + "." + body, webhook_secret_project)</code>. <code>body</code>{" "}
            adalah byte JSON persis yang dikirim. Verifikasi signature sebelum memproses, dan tolak
            timestamp di luar toleransi (disarankan 5 menit).
          </p>
          <Code>{`{
  "merchantOrderId": "PRJA-INV123",
  "projectOrderId": "INV123",
  "status": "PAID",
  "amount": 150000,
  "paymentMethod": "BT",
  "reference": "DS2463...",
  "updatedAt": "2026-11-03T15:06:07.800Z"
}`}</Code>
          <p>Contoh verifikasi Node.js:</p>
          <Code>{`import crypto from "node:crypto";

const rawBody = req.rawBody; // byte persis, jangan parse lalu stringify ulang
const header = req.headers["x-gapura-signature"]; // "t=...,v1=..."
const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
const age = Math.abs(Date.now() / 1000 - Number(parts.t));
if (age > 300) throw new Error("timestamp terlalu lama");

const expected = crypto
  .createHmac("sha256", process.env.GAPURA_WEBHOOK_SECRET)
  .update(parts.t + "." + rawBody)
  .digest("hex");

if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))) {
  throw new Error("signature salah");
}`}</Code>
          <p>Contoh verifikasi PHP:</p>
          <Code>{`$raw = file_get_contents("php://input");
$parts = [];
foreach (explode(",", $_SERVER["HTTP_X_GAPURA_SIGNATURE"]) as $pair) {
    [$key, $value] = explode("=", $pair, 2);
    $parts[$key] = $value;
}
$expected = hash_hmac("sha256", $parts["t"] . "." . $raw, getenv("GAPURA_WEBHOOK_SECRET"));
if (!hash_equals($expected, $parts["v1"])) {
    http_response_code(401);
    exit;
}`}</Code>
          <p>Aturan pengiriman:</p>
          <ul>
            <li>Respons 2xx = terkirim. Selain 2xx atau timeout 10 detik = gagal.</li>
            <li>
              Retry otomatis: 1m, 5m, 15m, 1j, 6j, maksimal 8 percobaan; setelah itu status{" "}
              <code>DEAD</code> dan tampil di panel.
            </li>
            <li>
              Pengiriman bersifat <strong>at-least-once</strong>. Proses idempotent berdasarkan{" "}
              <code>merchantOrderId</code> + <code>status</code>.
            </li>
            <li>Balas cepat; lakukan pekerjaan berat setelah merespons.</li>
          </ul>
        </Section>

        <Section id="error" title="Kode error">
          <DocTable><table>
            <thead>
              <tr>
                <th>HTTP</th>
                <th>Kode</th>
                <th>Kapan</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>400</td>
                <td>
                  <code>INVALID_REQUEST</code>
                </td>
                <td>Body/filter tidak valid.</td>
              </tr>
              <tr>
                <td>401</td>
                <td>
                  <code>UNAUTHORIZED</code>
                </td>
                <td>Header API key tidak ada atau tidak dikenal.</td>
              </tr>
              <tr>
                <td>403</td>
                <td>
                  <code>PROJECT_INACTIVE</code>
                </td>
                <td>Project dinonaktifkan.</td>
              </tr>
              <tr>
                <td>404</td>
                <td>
                  <code>NOT_FOUND</code>
                </td>
                <td>Transaksi/endpoint tidak ada untuk project ini.</td>
              </tr>
              <tr>
                <td>409</td>
                <td>
                  <code>DUPLICATE_ORDER</code>
                </td>
                <td>
                  <code>orderId</code> sudah dipakai dengan <code>amount</code> atau{" "}
                  <code>paymentMethod</code> berbeda.
                </td>
              </tr>
              <tr>
                <td>409</td>
                <td>
                  <code>ORDER_IN_PROGRESS</code>
                </td>
                <td>
                  Invoice untuk <code>orderId</code> ini masih dibuat; ulangi request yang sama
                  setelah <code>Retry-After</code>.
                </td>
              </tr>
              <tr>
                <td>502</td>
                <td>
                  <code>PROVIDER_ERROR</code>
                </td>
                <td>Duitku menolak atau tidak bisa dihubungi.</td>
              </tr>
              <tr>
                <td>503</td>
                <td>
                  <code>PROVIDER_NOT_CONFIGURED</code>
                </td>
                <td>Kredensial Duitku belum diset di Worker.</td>
              </tr>
              <tr>
                <td>500</td>
                <td>
                  <code>INTERNAL</code>
                </td>
                <td>Kesalahan tak terduga; aman untuk dicoba ulang.</td>
              </tr>
            </tbody>
          </table></DocTable>
          <p>
            Semua error berbentuk{" "}
            <code>{`{"error":{"code":"...","message":"..."}}`}</code>.
          </p>
        </Section>

        <Section id="panel" title="Panduan panel">
          <p>
            Panel login dengan email, password, dan kode TOTP. Sesi dikirim Worker sebagai cookie{" "}
            <code>__Host-gapura_admin</code> yang <code>HttpOnly</code>; token sesi tidak pernah
            disimpan di JavaScript. CSRF token untuk header write disimpan di{" "}
            <code>sessionStorage</code> tab, dan tombol <strong>Keluar</strong> mencabut sesi di
            server.
          </p>
          <p>
            Saat belum ada admin, panel menampilkan form setup. Isi setup token (
            <code>ADMIN_SETUP_TOKEN</code>), email, dan password; panel menampilkan secret +{" "}
            <code>otpauth://</code> untuk didaftarkan ke authenticator, lalu kode TOTP mengaktifkan
            owner. Bootstrap hanya bisa sekali.
          </p>
          <p>
            Role <code>owner</code> dan <code>admin</code> boleh menulis; <code>viewer</code> hanya
            membaca dan tombol write disembunyikan. Aksi sensitif (buat/edit/status project, rotasi
            API key/webhook secret, simpan/aktifkan kredensial, dan kirim ulang webhook) butuh TOTP
            ulang dalam 15 menit. Bila sudah kedaluwarsa, panel membuka modal verifikasi lalu
            mengulang aksi yang tadi.
          </p>
          <ul>
            <li>
              <strong>Ringkasan</strong>: total transaksi PAID hari ini dan bulan ini per project.
            </li>
            <li>
              <strong>Project</strong>: tambah project (nama, prefix 3-6 huruf kapital, webhook
              URL). API key dan webhook secret tampil <em>sekali</em>. Tombol Edit mengubah nama dan
              webhook URL; prefix tidak bisa diubah. Nonaktifkan menolak transaksi baru. Rotasi
              membuat kredensial baru dan membuat yang lama tidak berlaku.
            </li>
            <li>
              <strong>Transaksi</strong>: filter project/status, paging, dan detail berisi riwayat
              webhook.
            </li>
            <li>
              <strong>Webhook gagal</strong>: daftar <code>FAILED</code> (menunggu retry) dan{" "}
              <code>DEAD</code>; tombol kirim ulang menjadwalkan percobaan baru.
            </li>
            <li>
              <strong>Pengaturan</strong>: merchant code + API key sandbox/production (terenkripsi
              AES-GCM di D1), aktivasi environment, dan uji kredensial lewat getPaymentMethod.
            </li>
            <li>
              <strong>Audit</strong>: 100 aksi admin terakhir tanpa nilai secret.
            </li>
          </ul>
          <p>
            Setiap aksi admin dicatat di <code>admin_audit</code> dengan email aktor sesi.
          </p>
        </Section>

        <Section id="admin-api" title="Admin API">
          <p>
            Semua endpoint admin memakai sesi cookie <code>__Host-gapura_admin</code> (
            <code>HttpOnly</code>, <code>Secure</code>, <code>SameSite=Strict</code>). Token sesi
            tidak dikirim lewat header <code>Authorization</code>. Request tulis juga wajib
            mengirim <code>X-CSRF-Token</code> dan berasal dari origin panel yang terdaftar.
          </p>
          <p>
            Endpoint auth: <code>GET /admin/auth/status</code>,{" "}
            <code>POST /admin/auth/bootstrap/start</code>, <code>POST /admin/auth/bootstrap</code>,{" "}
            <code>POST /admin/auth/login</code>, <code>POST /admin/auth/logout</code>,{" "}
            <code>GET /admin/auth/session</code>, dan <code>POST /admin/auth/reauth</code>. Login
            butuh password + TOTP; reauth memperbarui <code>reauthenticated_at</code> sesi.
          </p>
          <DocTable><table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Fungsi</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>GET /admin/summary</code>
                </td>
                <td>Total PAID hari/bulan per project.</td>
              </tr>
              <tr>
                <td>
                  <code>GET /admin/projects</code>
                </td>
                <td>Daftar project.</td>
              </tr>
              <tr>
                <td>
                  <code>POST /admin/projects</code>
                </td>
                <td>
                  Buat project; mengembalikan <code>apiKey</code> dan <code>webhookSecret</code>{" "}
                  sekali.
                </td>
              </tr>
              <tr>
                <td>
                  <code>PATCH /admin/projects/:id</code>
                </td>
                <td>
                  Edit <code>name</code>/<code>webhookUrl</code>, atau{" "}
                  <code>{"{ isActive: boolean }"}</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>POST /admin/projects/:id/rotate-key</code>
                </td>
                <td>API key baru (sekali tampil).</td>
              </tr>
              <tr>
                <td>
                  <code>POST /admin/projects/:id/rotate-secret</code>
                </td>
                <td>Webhook secret baru (sekali tampil).</td>
              </tr>
              <tr>
                <td>
                  <code>GET /admin/transactions</code>
                </td>
                <td>
                  Filter <code>projectId</code>, <code>status</code>, <code>from</code>,{" "}
                  <code>to</code>, <code>limit</code> (≤100), <code>offset</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>GET /admin/transactions/:merchantOrderId</code>
                </td>
                <td>Detail + seluruh riwayat webhook.</td>
              </tr>
              <tr>
                <td>
                  <code>GET /admin/webhooks?status=FAILED|DEAD</code>
                </td>
                <td>Antrean webhook gagal.</td>
              </tr>
              <tr>
                <td>
                  <code>POST /admin/webhooks/:id/retry</code>
                </td>
                <td>Jadwalkan ulang percobaan (attempt 1, jatuh tempo sekarang).</td>
              </tr>
              <tr>
                <td>
                  <code>GET /admin/settings</code>
                </td>
                <td>Status kredensial sandbox/production + callback URL.</td>
              </tr>
              <tr>
                <td>
                  <code>PUT /admin/settings/:environment</code>
                </td>
                <td>
                  Simpan merchant code/API key (API key opsional saat update).
                </td>
              </tr>
              <tr>
                <td>
                  <code>POST /admin/settings/:environment/activate</code>
                </td>
                <td>Jadikan environment aktif untuk transaksi baru.</td>
              </tr>
              <tr>
                <td>
                  <code>POST /admin/settings/:environment/test</code>
                </td>
                <td>Uji kredensial lewat getPaymentMethod.</td>
              </tr>
              <tr>
                <td>
                  <code>GET /admin/audit</code>
                </td>
                <td>Jejak aksi admin.</td>
              </tr>
            </tbody>
          </table></DocTable>
        </Section>

        <Section id="batasan" title="Batasan & keamanan">
          <ul>
            <li>Gapura tidak menyimpan data kartu dan tidak menangani dana; uang masuk ke akun Duitku.</li>
            <li>Data pembeli minim: nama dan email; tidak dicatat di log.</li>
            <li>Semua trafik HTTPS. Kredensial Duitku hanya di Worker secrets.</li>
            <li>
              Admin memakai sesi opaque per perangkat dengan TOTP wajib, RBAC owner/admin/viewer, dan
              step-up 15 menit. Belum ada recovery code; kehilangan authenticator berarti pemulihan
              manual di D1. Rate limit login/TOTP per akun + IP. Biaya CPU Argon2id di Workers belum
              diukur.
            </li>
            <li>
              Retry webhook memakai Cron tiap menit; keterlambatan minimal sekitar satu menit.
              Riwayat <code>DELIVERED</code>/<code>DEAD</code> dipangkas setelah 30 hari.
            </li>
            <li>Layanan hanya Cloudflare free tier: Workers, D1, Cron Trigger, Pages.</li>
          </ul>
        </Section>

        <Section id="troubleshooting" title="Troubleshooting">
          <DocTable><table>
            <thead>
              <tr>
                <th>Gejala</th>
                <th>Penyebab & tindakan</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>503 PROVIDER_NOT_CONFIGURED</code>
                </td>
                <td>
                  Secret Duitku atau <code>PUBLIC_BASE_URL</code> kosong. Set via{" "}
                  <code>wrangler secret put</code>.
                </td>
              </tr>
              <tr>
                <td>
                  <code>502 PROVIDER_ERROR</code>
                </td>
                <td>
                  Duitku menolak inquiry. Cek kredensial, metode aktif, dan base URL sandbox/produksi.
                </td>
              </tr>
              <tr>
                <td>Webhook tidak masuk</td>
                <td>
                  Pastikan project membalas 2xx, signature diverifikasi dengan body mentah, dan
                  timestamp masih segar. Buka halaman Webhook gagal di panel.
                </td>
              </tr>
              <tr>
                <td>Status tidak berubah</td>
                <td>
                  Callback mungkin tidak sampai; transaksi PENDING lama disinkronkan otomatis setelah
                  10 menit. Cek <code>GET /v1/payments/:orderId</code>.
                </td>
              </tr>
              <tr>
                <td>Panel 401</td>
                <td>Sesi kedaluwarsa atau dicabut. Masuk lagi dengan password + TOTP.</td>
              </tr>
              <tr>
                <td>
                  <code>403 REAUTH_REQUIRED</code>
                </td>
                <td>Masukkan kode TOTP di modal verifikasi; aksi sensitif berlaku 15 menit.</td>
              </tr>
              <tr>
                <td>
                  <code>403 FORBIDDEN</code>
                </td>
                <td>Role viewer hanya boleh membaca; minta owner/admin melakukan perubahan.</td>
              </tr>
              <tr>
                <td>Setup tidak tersedia</td>
                <td>
                  <code>ADMIN_SETUP_TOKEN</code> atau <code>CREDENTIALS_KEY</code> belum diset di
                  Worker.
                </td>
              </tr>
            </tbody>
          </table></DocTable>
        </Section>
        </article>
      </div>
    </>
  );
}
