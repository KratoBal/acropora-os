"use client";

import { useSearchParams } from "next/navigation";

import { BillingDocumentEditor } from "./billing-document-editor";
import { CONTRACT_INVOICE_HANDOFF_PARAM } from "./contract-invoice-handoff";
import { POS_INVOICE_HANDOFF_PARAM } from "./pos-invoice-handoff";

/**
 * Az Új számla oldal: a pénztárból a kosár, a beszerzési szerződésből a
 * szerződés csomagjának kulcsát is átadja.
 */
export function NewBillingDocument() {
  const params = useSearchParams();
  return (
    <BillingDocumentEditor
      posHandoffKey={params.get(POS_INVOICE_HANDOFF_PARAM) ?? undefined}
      contractHandoffKey={
        params.get(CONTRACT_INVOICE_HANDOFF_PARAM) ?? undefined
      }
    />
  );
}
