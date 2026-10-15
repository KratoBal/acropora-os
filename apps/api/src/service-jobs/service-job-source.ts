import type { ServiceJobSource } from "@acropora/types";

/** The detail row's three source fields (`ServiceJobsRepository.detail`). */
export interface ServiceJobSourceRow {
  contract: { id: string; number: string; title: string } | null;
  maintenanceOrder: {
    id: string;
    number: string;
    source: "GENERATED" | "CUSTOMER_FORM";
  } | null;
  contractItems: readonly { description: string }[];
}

/**
 * WHERE THE JOB'S ITEMS COME FROM (karbantartási felmérés S7), with the same
 * precedence as the completion certificate (S5): the order sheet first, then
 * the contract items recorded on the job. A contract without an order sheet
 * is still reported when it has no items: that job gets no certificate, and
 * the page has to be able to say so.
 */
export function serviceJobSource(
  row: ServiceJobSourceRow,
): ServiceJobSource | null {
  if (row.maintenanceOrder)
    return {
      kind: "MAINTENANCE_ORDER",
      orderId: row.maintenanceOrder.id,
      orderNumber: row.maintenanceOrder.number,
      customerForm: row.maintenanceOrder.source === "CUSTOMER_FORM",
      contract: row.contract,
    };
  if (row.contract)
    return {
      kind: "CONTRACT",
      contract: row.contract,
      itemDescriptions: row.contractItems.map((item) => item.description),
    };
  return null;
}
