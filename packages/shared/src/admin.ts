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

export const merchantSettingsInputSchema = z
  .object({
    merchantCode: z.string().min(1).max(50),
    apiKey: z.string().min(8).max(200).optional(),
  })
  .strict();

export type MerchantSettingsInput = z.infer<typeof merchantSettingsInputSchema>;

export const createAdminInputSchema = z
  .object({
    email: z.email().max(254),
    role: z.enum(["admin", "viewer"]),
    password: z.string().min(12).max(200).optional(),
  })
  .strict();

export type CreateAdminInput = z.infer<typeof createAdminInputSchema>;

export const resetAdminPasswordInputSchema = z
  .object({
    password: z.string().min(12).max(200).optional(),
  })
  .strict();

export type ResetAdminPasswordInput = z.infer<typeof resetAdminPasswordInputSchema>;

export const activateAdminInputSchema = z
  .object({
    totpCode: z.string().regex(/^\d{6}$/),
  })
  .strict();

export type ActivateAdminInput = z.infer<typeof activateAdminInputSchema>;

export const recoveryLoginInputSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(200),
    recoveryCode: z.string().min(1).max(64),
  })
  .strict();

export type RecoveryLoginInput = z.infer<typeof recoveryLoginInputSchema>;

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
