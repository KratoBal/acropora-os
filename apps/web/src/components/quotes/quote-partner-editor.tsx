"use client";

import { Alert, PilotButton, PilotCard } from "@acropora/ui";
import type { CustomerSummary, QuoteDetailDto } from "@acropora/types";
import { useState } from "react";

import { quotesApi } from "@/lib/api/quotes";

import { errorText } from "./quote-format";
import { QuotePartnerPicker } from "./quote-partner-picker";

/**
 * THE QUOTE'S PARTNER (Luca, 2026-11-20, Discord: a copy made by "Másolat új ajánlatként" could be renamed but its PARTNER could not
 * be changed). The same partner search as on the "new quote" page; a pick is only SAVED on the button, so a mis-click never swaps the
 * partner. The API accepts a head change only on a DRAFT whose versions were never published (the page offers the button exactly then,
 * `canEditQuoteTitle`), and it rebuilds the draft versions' printed partner data for the new partner. The recipient of the send
 * ("Címzett") and the customer's name in the mail text come from the quote's partner at the time the mail is prepared, so they follow
 * the swap; a mail already prepared is not touched here.
 */
export function QuotePartnerEditor({
  token,
  quote,
  canCreateCustomer,
  onSaved,
  onClose,
}: {
  token: string;
  quote: QuoteDetailDto;
  canCreateCustomer: boolean;
  onSaved: (customer: { id: string; displayName: string }) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<CustomerSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const same = picked !== null && picked.id === quote.customerId;

  const save = async () => {
    if (!picked || same || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await quotesApi.updateHeader(token, quote.id, {
        customerId: picked.id,
      });
      onSaved({
        id: updated.customerId ?? picked.id,
        displayName: updated.customerName ?? picked.displayName,
      });
    } catch (cause) {
      setError(errorText(cause, "A partner nem cserélhető."));
      setBusy(false);
    }
  };

  return (
    <PilotCard>
      <div className="space-y-3 p-5">
        <p className="text-sm font-semibold text-pilot-grey-900">
          Az ajánlat partnere
        </p>
        <p className="text-sm text-pilot-grey-600">
          Jelenlegi partner: {quote.customerName ?? "nincs"}. A csere a még ki
          nem küldött ajánlaton megy; az ajánlat tételei nem változnak, a
          nyomtatott partneradat és a küldés címzettje az új partneré lesz.
        </p>
        {picked ? (
          <div className="flex items-center justify-between rounded-lg border border-pilot-grey-200 px-3 py-2">
            <span className="font-semibold">{picked.displayName}</span>
            <PilotButton
              variant="ghost"
              disabled={busy}
              onClick={() => setPicked(null)}
            >
              Másik
            </PilotButton>
          </div>
        ) : (
          <QuotePartnerPicker
            token={token}
            canCreateCustomer={canCreateCustomer}
            onSelect={setPicked}
          />
        )}
        {same ? (
          <p role="status" className="text-sm text-pilot-grey-600">
            Ez már az ajánlat partnere.
          </p>
        ) : null}
        {error ? (
          <Alert variant="danger" title="Hiba történt" description={error} />
        ) : null}
        <div className="flex gap-2">
          <PilotButton
            disabled={!picked || same || busy}
            onClick={() => void save()}
          >
            Partner mentése
          </PilotButton>
          <PilotButton variant="secondary" disabled={busy} onClick={onClose}>
            Mégse
          </PilotButton>
        </div>
      </div>
    </PilotCard>
  );
}
