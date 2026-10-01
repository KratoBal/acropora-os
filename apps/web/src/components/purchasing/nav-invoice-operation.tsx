import { Badge } from "@acropora/ui";
import type { NavIncomingInvoiceSummary } from "@acropora/types";

/**
 * A NAV módosító és sztornó okirata (jóváíró) jelölése: az alapszámlán nincs
 * jel, a másik kettőn a művelet és az eredeti számla sorszáma.
 */
export function NavInvoiceOperationNote({
  invoice,
}: {
  invoice: Pick<
    NavIncomingInvoiceSummary,
    "invoiceOperation" | "originalInvoiceNumber"
  >;
}) {
  if (invoice.invoiceOperation === "CREATE") return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant="warning">
        {invoice.invoiceOperation === "STORNO" ? "Sztornó" : "Módosító"}
      </Badge>
      {invoice.originalInvoiceNumber ? (
        <span className="text-xs text-dusk-500">
          eredeti: {invoice.originalInvoiceNumber}
        </span>
      ) : null}
    </span>
  );
}
