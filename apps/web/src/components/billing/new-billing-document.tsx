"use client";

import { useSearchParams } from "next/navigation";

import { BillingDocumentEditor } from "./billing-document-editor";
import { POS_INVOICE_HANDOFF_PARAM } from "./pos-invoice-handoff";

/** Az Új számla oldal: a pénztárból érkezve a kosár kulcsát is átadja. */
export function NewBillingDocument() {
  const posHandoffKey =
    useSearchParams().get(POS_INVOICE_HANDOFF_PARAM) ?? undefined;
  return <BillingDocumentEditor posHandoffKey={posHandoffKey} />;
}
