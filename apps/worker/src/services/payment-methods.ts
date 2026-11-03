import { paymentChannelByCode } from "@gapura/shared/payment-methods";
import type { PaymentMethodProvider } from "../providers/duitku";

export interface PaymentMethodView {
  code: string;
  name: string;
  officialName: string | null;
  system: string | null;
  image: string;
  totalFee: string;
}

export interface PaymentMethodsService {
  list(amount: number): Promise<PaymentMethodView[]>;
}

export function createPaymentMethodsService(deps: {
  provider: PaymentMethodProvider;
}): PaymentMethodsService {
  return {
    async list(amount: number): Promise<PaymentMethodView[]> {
      const methods = await deps.provider.getPaymentMethods(amount);
      return methods.map((method) => {
        const catalog = paymentChannelByCode(method.code);
        return {
          code: method.code,
          name: method.name,
          officialName: catalog?.name ?? null,
          system: catalog?.system ?? null,
          image: method.image,
          totalFee: method.totalFee,
        };
      });
    },
  };
}
