import { apiRequest } from "./client";

/** App-local mirror of packages/types/src/integrations/unas-order-sync.ts. */
export interface UnasOrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  unasStatusLabel: string | null;
  buyerName: string | null;
  paymentName: string | null;
  shippingName: string | null;
  totalGross: string;
  currency: string;
  lineCount: number;
  createdAt: string;
  orderedAt: string | null;
  unasDeletedAt: string | null;
}

export interface UnasOrderListResponse {
  items: UnasOrderListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface UnasOrderLineDetail {
  id: string;
  variantId: string | null;
  sku: string;
  description: string;
  quantity: string;
  unit: string;
  unitNet: string;
  taxRate: string;
  lineGross: string;
  syncStatus: "PENDING" | "OK" | "FAILED";
  syncError: string | null;
  unasRemovedAt: string | null;
}

export interface UnasOrderInvoiceSummary {
  id: string;
  invoiceNumber: string;
  externalUrl: string | null;
  syncStatus: "PENDING" | "RECEIVED" | "ERROR";
  createdAt: string;
}

export interface UnasOrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  unasStatusLabel: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  paymentName: string | null;
  paymentStatus: string | null;
  shippingName: string | null;
  currency: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  orderedAt: string | null;
  createdAt: string;
  unasDeletedAt: string | null;
  lines: UnasOrderLineDetail[];
  unasInvoiceStatus: "NOT_BILLABLE" | "BILLABLE" | "BILLED" | null;
  invoices: UnasOrderInvoiceSummary[];
}

export function listUnasOrders(page = 1, pageSize = 20) {
  return apiRequest<UnasOrderListResponse>(
    `/integrations/unas/orders?page=${page}&pageSize=${pageSize}`,
  );
}

export function getUnasOrder(id: string) {
  return apiRequest<UnasOrderDetail>(
    `/integrations/unas/orders/${encodeURIComponent(id)}`,
  );
}
