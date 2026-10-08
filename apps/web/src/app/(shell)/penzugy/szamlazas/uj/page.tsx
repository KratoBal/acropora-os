import { Suspense } from "react";

import { NewBillingDocument } from "@/components/billing/new-billing-document";

export default function NewBillingDocumentPage() {
  // a pénztár kosarának kulcsa a keresőparaméterben él (`useSearchParams`)
  return (
    <Suspense fallback={null}>
      <NewBillingDocument />
    </Suspense>
  );
}
