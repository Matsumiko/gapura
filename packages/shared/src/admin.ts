import { z } from "zod";

export const createProjectInputSchema = z
  .object({
    name: z.string().min(1).max(100),
    prefix: z.string().regex(/^[A-Z]{3,6}$/, { message: "prefix 3-6 huruf kapital" }),
    webhookUrl: z.url({ protocol: /^https?$/ }).max(2048),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

/** Prefix sengaja tidak bisa diubah: sudah melekat pada merchantOrderId di Duitku. */
export const updateProjectInputSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    webhookUrl: z.url({ protocol: /^https?$/ }).max(2048).optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.webhookUrl !== undefined, {
    message: "minimal satu field diisi",
  });

export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export const TRANSACTION_STATUS_VALUES = ["PENDING", "PAID", "FAILED", "EXPIRED"] as const;

export const adminTransactionFilterSchema = z
  .object({
    projectId: z.string().min(1).max(64).optional(),
    status: z.enum(TRANSACTION_STATUS_VALUES).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type AdminTransactionFilter = z.infer<typeof adminTransactionFilterSchema>;
