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
  })
  .strict()
  .superRefine((value, ctx) => {
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
  });

export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;
