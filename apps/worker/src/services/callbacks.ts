import { secureEqual } from "@gapura/shared/hmac";
import { callbackSignature } from "../providers/duitku";
import type { ForwardInstruction } from "./payload";
import type { TransactionRepository } from "../types";

export type CallbackOutcome =
  | "ok"
  | "bad_parameter"
  | "bad_signature"
  | "ignored"
  | "amount_mismatch"
  | "duplicate";

export interface CallbackResult {
  outcome: CallbackOutcome;
  forward?: ForwardInstruction;
}

export interface CallbackService {
  handle(fields: Record<string, string>): Promise<CallbackResult>;
}

export interface CallbackDeps {
  transactions: TransactionRepository;
  credentials: () => Promise<{ merchantCode: string; apiKey: string } | null>;
  now: () => Date;
}

export function createCallbackService(deps: CallbackDeps): CallbackService {
  return {
    async handle(fields: Record<string, string>): Promise<CallbackResult> {
      const { merchantCode, amount, merchantOrderId, resultCode, signature } = fields;
      if (!merchantCode || !amount || !merchantOrderId || !resultCode || !signature) {
        return { outcome: "bad_parameter" };
      }
      const credentials = await deps.credentials();
      if (!credentials || merchantCode !== credentials.merchantCode) {
        return { outcome: "bad_signature" };
      }

      const expected = await callbackSignature(
        credentials.merchantCode,
        amount,
        merchantOrderId,
        credentials.apiKey,
      );
      if (!secureEqual(expected, signature.toLowerCase())) {
        return { outcome: "bad_signature" };
      }

      const row = await deps.transactions.findWithProject(merchantOrderId);
      if (!row) {
        return { outcome: "ignored" };
      }

      const callbackAmount = Number(amount);
      if (!Number.isSafeInteger(callbackAmount) || callbackAmount !== row.transaction.amount) {
        return { outcome: "amount_mismatch" };
      }

      if (!row.transaction.reference && fields.reference) {
        await deps.transactions.setReferenceIfMissing(merchantOrderId, fields.reference);
      }

      const status = resultCode === "00" ? "PAID" : "FAILED";
      const updatedAt = deps.now().toISOString();
      const changed = await deps.transactions.markStatus(merchantOrderId, status, updatedAt);
      if (!changed) {
        return { outcome: "duplicate" };
      }

      return {
        outcome: "ok",
        forward: {
          project: row.project,
          payload: {
            merchantOrderId,
            projectOrderId: row.transaction.projectOrderId,
            status,
            amount: row.transaction.amount,
            paymentMethod: row.transaction.paymentMethod ?? fields.paymentCode ?? null,
            reference: row.transaction.reference ?? fields.reference ?? null,
            updatedAt,
          },
        },
      };
    },
  };
}
