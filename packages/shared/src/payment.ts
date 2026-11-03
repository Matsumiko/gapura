import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

/**
 * Body `POST /v1/payments`. `amount` dalam rupiah bulat, tanpa desimal.
 * `.strict()` supaya salah ketik nama field ditolak, bukan diabaikan diam-diam.
 */
export const createPaymentInputSchema = z
  .object({
    orderId: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => value.trim() === value, { message: "orderId tanpa spasi di awal/akhir" }),
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    productDetails: z.string().min(1).max(255),
    customerName: z.string().min(1).max(255),
    email: z.email().max(255),
    paymentMethod: z.string().min(1).max(32),
    returnUrl: httpUrl,
  })
  .strict();

export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;
