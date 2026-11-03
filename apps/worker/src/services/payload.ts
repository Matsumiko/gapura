import type { PaymentStatus, ProjectWebhookTarget, TransactionRecord } from "../types";

export interface PaymentWebhookPayload {
  merchantOrderId: string;
  projectOrderId: string;
  status: PaymentStatus;
  amount: number;
  paymentMethod: string | null;
  reference: string | null;
  updatedAt: string;
}

export function paymentPayload(transaction: TransactionRecord): PaymentWebhookPayload {
  return {
    merchantOrderId: transaction.merchantOrderId,
    projectOrderId: transaction.projectOrderId,
    status: transaction.status,
    amount: transaction.amount,
    paymentMethod: transaction.paymentMethod,
    reference: transaction.reference,
    updatedAt: transaction.updatedAt,
  };
}

export interface ForwardInstruction {
  project: ProjectWebhookTarget;
  payload: PaymentWebhookPayload;
}
