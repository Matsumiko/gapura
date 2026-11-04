import { z } from "zod";
import { paymentChannelByCode } from "./payment-methods";

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

/**
 * Body `POST /v1/payments`. `amount` dalam rupiah bulat, tanpa desimal.
 * `.strict()` supaya salah ketik nama field ditolak, bukan diabaikan diam-diam.
 */
export const creditCardDetailSchema = z
  .object({
    acquirer: z.enum(["014", "022"]).optional(),
    binWhitelist: z
      .array(z.string().regex(/^(\d{3}|\d{6})$/, { message: "BIN harus 3 atau 6 digit" }))
      .max(25)
      .optional(),
  })
  .strict();

export type CreditCardDetail = z.infer<typeof creditCardDetailSchema>;

/**
 * `accountLink` hanya untuk channel account link OVO (`OL`) dan ShopeePay (`SL`).
 * `credentialCode` diterbitkan Duitku untuk akun yang sudah ditautkan; bentuknya
 * dibatasi supaya tidak ada spasi/kontrol yang lolos ke body inquiry atau log.
 */
export const accountLinkSchema = z
  .object({
    credentialCode: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[A-Za-z0-9-]+$/, { message: "credentialCode hanya huruf, angka, dan tanda hubung" }),
    ovo: z
      .object({
        paymentDetails: z
          .array(
            z
              .object({
                // Vendor hanya mendokumentasikan CASH untuk OVO account link.
                paymentType: z.literal("CASH"),
                amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
              })
              .strict(),
          )
          // Vendor mendokumentasikan satu detail pembayaran CASH per transaksi.
          .length(1),
      })
      .strict()
      .optional(),
    shopee: z
      .object({
        useCoin: z.boolean(),
        // Vendor menyebut `promoId` pada contoh request dan `promo_ids` pada tabel;
        // Gapura memakai `promoId` (contoh request resmi) dan mengosongkannya bila tidak diisi.
        promoId: z.string().max(50).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AccountLink = z.infer<typeof accountLinkSchema>;

const optionalText = (max: number) => z.string().max(max).optional();

/** Alamat mengikuti objek `billingAddress`/`shippingAddress` Duitku; semua field opsional. */
export const customerAddressSchema = z
  .object({
    firstName: optionalText(255),
    lastName: optionalText(255),
    address: optionalText(255),
    city: optionalText(255),
    postalCode: optionalText(20),
    phone: optionalText(50),
    countryCode: optionalText(10),
  })
  .strict();

export type CustomerAddress = z.infer<typeof customerAddressSchema>;

/** Detail pelanggan opsional; vendor memakai bentuk ini untuk sebagian channel. */
export const customerDetailSchema = z
  .object({
    firstName: optionalText(255),
    lastName: optionalText(255),
    email: z.email().max(255).optional(),
    phoneNumber: optionalText(50),
    billingAddress: customerAddressSchema.optional(),
    shippingAddress: customerAddressSchema.optional(),
  })
  .strict();

export type CustomerDetail = z.infer<typeof customerDetailSchema>;

/** Rincian item; total `price × quantity` wajib sama dengan amount. */
export const itemDetailSchema = z
  .object({
    name: z.string().min(1).max(255),
    price: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    quantity: z.number().int().min(1).max(1_000_000),
  })
  .strict();

export type ItemDetail = z.infer<typeof itemDetailSchema>;

export const createPaymentInputSchema = z
  .object({
    orderId: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => value.trim() === value, { message: "orderId tanpa spasi di awal/akhir" }),
    // Duitku menolak nominal di bawah Rp10.000 (HTTP 400 Minimum Payment).
    amount: z.number().int().min(10_000).max(Number.MAX_SAFE_INTEGER),
    productDetails: z.string().min(1).max(255),
    customerName: z.string().min(1).max(255),
    // Vendor menulis 255 di tabel, tetapi daftar error menyebut batas 50; pakai yang lebih ketat.
    email: z.email().max(50),
    paymentMethod: z.string().regex(/^[A-Z0-9]{2}$/, { message: "kode metode pembayaran Duitku 2 karakter" }),
    returnUrl: httpUrl,
    expiryPeriod: z.number().int().min(1).max(10080).optional(),
    creditCardDetail: creditCardDetailSchema.optional(),
    accountLink: accountLinkSchema.optional(),
    // Field opsional Duitku; hanya dikirim bila project mengisinya.
    additionalParam: optionalText(255),
    merchantUserInfo: optionalText(255),
    phoneNumber: optionalText(50),
    itemDetails: z.array(itemDetailSchema).min(1).max(100).optional(),
    customerDetail: customerDetailSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.itemDetails) {
      const total = value.itemDetails.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );
      if (!Number.isSafeInteger(total) || total !== value.amount) {
        ctx.addIssue({
          code: "custom",
          path: ["itemDetails"],
          message: "total itemDetails (price × quantity) harus sama dengan amount",
        });
      }
    }

    const channel = paymentChannelByCode(value.paymentMethod);
    if (
      value.expiryPeriod !== undefined &&
      channel?.maxExpiryMinutes !== undefined &&
      channel.maxExpiryMinutes !== null &&
      value.expiryPeriod > channel.maxExpiryMinutes
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expiryPeriod"],
        message: `expiryPeriod maksimal ${channel.maxExpiryMinutes} menit untuk ${channel.code}`,
      });
    }
    if (value.creditCardDetail !== undefined && value.paymentMethod !== "VC") {
      ctx.addIssue({
        code: "custom",
        path: ["creditCardDetail"],
        message: "creditCardDetail hanya berlaku untuk paymentMethod VC",
      });
    }

    if (channel?.requiresAccountLink) {
      if (value.accountLink === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["accountLink"],
          message: `accountLink wajib untuk paymentMethod ${channel.code}`,
        });
        return;
      }
      if (channel.code === "OL" && value.accountLink.shopee !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["accountLink", "shopee"],
          message: "accountLink.shopee hanya untuk paymentMethod SL",
        });
      }
      if (channel.code === "SL" && value.accountLink.ovo !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["accountLink", "ovo"],
          message: "accountLink.ovo hanya untuk paymentMethod OL",
        });
      }
      if (channel.code === "OL" && value.accountLink.ovo === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["accountLink", "ovo"],
          message: "accountLink.ovo wajib untuk paymentMethod OL",
        });
      }
      if (channel.code === "SL" && value.accountLink.shopee === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["accountLink", "shopee"],
          message: "accountLink.shopee wajib untuk paymentMethod SL",
        });
      }
      if (value.accountLink.ovo !== undefined) {
        for (const detail of value.accountLink.ovo.paymentDetails) {
          if (detail.amount !== value.amount) {
            ctx.addIssue({
              code: "custom",
              path: ["accountLink", "ovo", "paymentDetails"],
              message: "amount pada paymentDetails OVO harus sama dengan amount transaksi",
            });
          }
        }
      }
      return;
    }

    if (value.accountLink !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["accountLink"],
        message: "accountLink hanya berlaku untuk paymentMethod OL atau SL",
      });
    }
  });

export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;
