"use client";

import { Alert, PilotButton, PilotCard, PilotInput } from "@acropora/ui";
import type { QuoteDetailDto } from "@acropora/types";
import { useState } from "react";

import { quotesApi } from "@/lib/api/quotes";

import { errorText } from "./quote-format";

/**
 * Whether the quote's title can be changed: the API (`QuotesRepository.update`) accepts a head change only while the quote is a DRAFT
 * and no version was ever published, so the page offers the button exactly then. A refusal from the API still shows its own sentence.
 */
export const canEditQuoteTitle = (quote: QuoteDetailDto, canManage: boolean) =>
  canManage &&
  quote.status === "DRAFT" &&
  quote.versions.every((v) => v.status === "DRAFT");

/**
 * THE QUOTE'S TITLE (Luca, 2026-11-12, task quote-masolat-cim): the title was set once on the "new quote" page and never again, so a copy
 * ("<title> (másolat)") could not be renamed. A small row under the header: the field, save, cancel. Saving sends only the title.
 */
export function QuoteTitleEditor({
  token,
  quote,
  onSaved,
  onClose,
}: {
  token: string;
  quote: QuoteDetailDto;
  onSaved: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(quote.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = title.trim();
  // why the save button is grey, said out loud
  const problem = !trimmed
    ? "Az ajánlat címe nem lehet üres."
    : trimmed.length > 200
      ? "Az ajánlat címe legfeljebb 200 karakter lehet."
      : null;
  const unchanged = trimmed === quote.title;

  const save = async () => {
    if (problem || busy) return;
    if (unchanged) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await quotesApi.updateHeader(token, quote.id, {
        title: trimmed,
      });
      onSaved(updated.title);
    } catch (cause) {
      setError(errorText(cause, "A cím nem menthető."));
      setBusy(false);
    }
  };

  return (
    <PilotCard>
      <div className="space-y-3 p-5">
        <p className="text-sm font-semibold text-pilot-grey-900">
          Az ajánlat címe
        </p>
        <PilotInput
          aria-label="Az ajánlat címe"
          value={title}
          onChange={setTitle}
          maxLength={200}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
            if (event.key === "Escape") onClose();
          }}
        />
        {problem ? (
          <p role="status" className="text-sm text-pilot-grey-600">
            {problem}
          </p>
        ) : null}
        {error ? (
          <Alert variant="danger" title="Hiba történt" description={error} />
        ) : null}
        <div className="flex gap-2">
          <PilotButton
            disabled={Boolean(problem) || busy}
            onClick={() => void save()}
          >
            Cím mentése
          </PilotButton>
          <PilotButton variant="secondary" disabled={busy} onClick={onClose}>
            Mégse
          </PilotButton>
        </div>
      </div>
    </PilotCard>
  );
}
