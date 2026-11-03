import { buildMerchantOrderId } from "@gapura/shared/order";
import type { CreatePaymentInput } from "@gapura/shared/payment";
import { PaymentProviderError, type PaymentProvider } from "../providers/duitku";
import type {
  PaymentStatus,
  ProjectRecord,
  TransactionRecord,
  TransactionRepository,
} from "../types";

export class DuplicateOrderError extends Error {
  constructor() {
    super("orderId sudah dipakai project ini");
    this.name = "DuplicateOrderError";
  }
}

export interface PaymentResponse {
  merchantOrderId: string;
  projectOrderId: string;
  amount: number;
  status: PaymentStatus;
  paymentMethod: string | null;
  paymentUrl: string | null;
  reference: string | null;
  vaNumber: string | null;
  qrString: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPaymentResponse(record: TransactionRecord): PaymentResponse {
  return {
    merchantOrderId: record.merchantOrderId,
    projectOrderId: record.projectOrderId,
    amount: record.amount,
    status: record.status,
    paymentMethod: record.paymentMethod,
    paymentUrl: record.paymentUrl,
    reference: record.reference,
    vaNumber: record.vaNumber,
    qrString: record.qrString,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export interface PaymentsService {
  create(project: ProjectRecord, input: CreatePaymentInput): Promise<TransactionRecord>;
  get(projectId: string, projectOrderId: string): Promise<TransactionRecord | null>;
}

export interface PaymentsDeps {
  transactions: TransactionRepository;
  provider: PaymentProvider;
  publicBaseUrl: string;
  now: () => Date;
}

export function createPaymentsService(deps: PaymentsDeps): PaymentsService {
  return {
    async create(project: ProjectRecord, input: CreatePaymentInput): Promise<TransactionRecord> {
      if (!deps.publicBaseUrl) {
        throw new PaymentProviderError(
          "PROVIDER_NOT_CONFIGURED",
          "PUBLIC_BASE_URL belum diset sehingga callback URL tidak bisa dibentuk.",
        );
      }

      const createdAt = deps.now().toISOString();
      const merchantOrderId = buildMerchantOrderId(project.prefix, input.orderId);
      const inserted = await deps.transactions.insertPending({
        merchantOrderId,
        projectId: project.id,
        projectOrderId: input.orderId,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        createdAt,
      });
      if (!inserted) {
        throw new DuplicateOrderError();
      }

      let invoice;
      try {
        invoice = await deps.provider.createInvoice({
          merchantOrderId,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          productDetails: input.productDetails,
          customerName: input.customerName,
          email: input.email,
          returnUrl: input.returnUrl,
          callbackUrl: `${deps.publicBaseUrl}/callback/duitku`,
        });
      } catch (error) {
        // Belum ada transaksi di Duitku, jadi baris PENDING dibuang agar project bisa mencoba lagi.
        await deps.transactions.deletePending(merchantOrderId);
        throw error instanceof PaymentProviderError
          ? error
          : new PaymentProviderError("NETWORK", "Gagal membuat transaksi ke Duitku.");
      }

      const updatedAt = deps.now().toISOString();
      await deps.transactions.attachInquiry(
        merchantOrderId,
        invoice.reference,
        invoice.paymentUrl,
        invoice.vaNumber,
        invoice.qrString,
        updatedAt,
      );

      return {
        merchantOrderId,
        projectId: project.id,
        projectOrderId: input.orderId,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        status: "PENDING",
        paymentUrl: invoice.paymentUrl,
        reference: invoice.reference,
        vaNumber: invoice.vaNumber,
        qrString: invoice.qrString,
        createdAt,
        updatedAt,
      };
    },

    async get(projectId: string, projectOrderId: string): Promise<TransactionRecord | null> {
      return deps.transactions.findByProjectOrder(projectId, projectOrderId);
    },
  };
}
