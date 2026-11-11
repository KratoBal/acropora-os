"use client";

import { useEffect, useState } from "react";

import {
  PilotButton,
  PilotDataRow,
  PilotFormField,
  PilotInput,
} from "@acropora/ui";
import {
  checkBillingIssueDates,
  type BillingIssueConfirmation,
  type BillingIssueSummary,
} from "@acropora/types";

/**
 * THE INVOICE CONFIRMATION (card 7ba97e0d; Balázs 2026-11-11 11:12-11:20 UTC).
 *
 * Before an invoice is issued, this window shows its basic data as the SERVER will send it (the issue summary comes
 * from the issue's own builder): the buyer's name, address and tax number, the issue date, the fulfilment date, the
 * payment due date, the payment method, and the address it goes to. The three dates are editable and the invoice is
 * made with them; the rest is shown only. For a card payment the due date follows the issue date (Balázs 11:14).
 *
 * "Elküldöm e-mailben" (Balázs 11:20): checked, the issued invoice goes to the address shown here. Where the sending
 * is part of the issue (an e-invoice), it is checked and cannot be unchecked; where the type is never sent, it is
 * not shown.
 */
export type BillingIssueDelivery = "REQUIRED" | "OPTIONAL" | "NONE";

export function BillingIssueConfirmDialog({
  open,
  title,
  consequence,
  confirmLabel,
  summary,
  loadError,
  recipients,
  delivery,
  send,
  onSendChange,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** What issuing means (the text the old confirmation carried). */
  consequence?: string;
  confirmLabel: string;
  /** Null while it loads. */
  summary: BillingIssueSummary | null;
  /** Why the summary could not be made (the issue would refuse the same way). */
  loadError: string | null;
  /** The address(es) the invoice goes to, as the letter will carry them. */
  recipients: readonly string[];
  delivery: BillingIssueDelivery;
  send: boolean;
  onSendChange: (send: boolean) => void;
  busy?: boolean;
  onConfirm: (confirmation: BillingIssueConfirmation, send: boolean) => void;
  onCancel: () => void;
}) {
  /*
    THE DATES ARE THE SUMMARY'S UNTIL EDITED, IN THE SAME RENDER: the edited values belong to one summary (its key),
    and a new summary starts from its own dates. Copying them in an effect left one render with empty dates, in which
    "Kiállítom" was off and a quick click was lost.
  */
  const [edited, setEdited] = useState<{
    key: string;
    issueDate: string;
    fulfillmentDate: string;
    dueDate: string;
  } | null>(null);
  const key = summary
    ? [
        summary.fingerprint,
        summary.issueDate,
        summary.fulfillmentDate,
        summary.dueDate,
      ].join("|")
    : "";
  const current =
    edited && edited.key === key
      ? edited
      : {
          key,
          issueDate: summary?.issueDate ?? "",
          fulfillmentDate: summary?.fulfillmentDate ?? "",
          dueDate: summary?.dueDate ?? "",
        };
  const { issueDate, fulfillmentDate, dueDate } = current;
  const setIssueDate = (value: string) =>
    setEdited({ ...current, issueDate: value });
  const setFulfillmentDate = (value: string) =>
    setEdited({ ...current, fulfillmentDate: value });
  const setDueDate = (value: string) =>
    setEdited({ ...current, dueDate: value });

  // ESC is "Mégsem": the safe direction, as in every confirmation
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const follows = summary?.dueDateFollowsIssueDate ?? false;
  const shownDue = follows ? issueDate : dueDate;
  const dates = summary
    ? checkBillingIssueDates(
        { issueDate, fulfillmentDate, dueDate: shownDue || null },
        {
          today: summary.issueDate,
          showsPaymentFields: summary.showsPaymentFields,
          dueDateFollowsIssueDate: follows,
        },
      )
    : null;
  const sending = delivery === "REQUIRED" || (delivery === "OPTIONAL" && send);
  const blocked =
    !summary || !dates?.ok
      ? dates && !dates.ok
        ? dates.error
        : null
      : sending && recipients.length === 0
        ? "Nincs e-mail cím, ahová a számla kimehetne: add meg a kiküldési e-mailben, vagy ne küldd ki."
        : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pilot-grey-900/30 p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="billing-issue-confirm"
        className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm font-semibold text-pilot-grey-900">{title}</p>
        {consequence ? (
          <p className="text-sm text-pilot-grey-700">{consequence}</p>
        ) : null}

        {loadError ? (
          <p role="alert" className="text-sm text-rose-700">
            {loadError}
          </p>
        ) : !summary ? (
          <p className="text-sm text-pilot-grey-500">
            A számla adatainak betöltése…
          </p>
        ) : (
          <>
            <div>
              <PilotDataRow
                label="Vevő neve"
                value={summary.buyerName}
                labelWidth="140px"
              />
              <PilotDataRow
                label="Vevő címe"
                value={summary.buyerAddress}
                labelWidth="140px"
              />
              <PilotDataRow
                label="Adószám"
                value={
                  summary.buyerTaxNumber ??
                  summary.buyerEuTaxNumber ??
                  undefined
                }
                labelWidth="140px"
              />
              {summary.showsPaymentFields ? (
                <PilotDataRow
                  label="Fizetési mód"
                  value={summary.paymentMethod ?? undefined}
                  labelWidth="140px"
                />
              ) : null}
              {delivery !== "NONE" ? (
                <PilotDataRow
                  label="Küldési cím"
                  value={recipients.join(", ") || undefined}
                  labelWidth="140px"
                />
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <PilotFormField label="Számla kelte">
                <PilotInput
                  aria-label="Számla kelte"
                  type="date"
                  value={issueDate}
                  max={summary.issueDate}
                  onChange={setIssueDate}
                  disabled={busy}
                />
              </PilotFormField>
              <PilotFormField label="Teljesítés ideje">
                <PilotInput
                  aria-label="Teljesítés ideje"
                  type="date"
                  value={fulfillmentDate}
                  onChange={setFulfillmentDate}
                  disabled={busy}
                />
              </PilotFormField>
              {summary.showsPaymentFields ? (
                <PilotFormField label="Fizetési határidő">
                  <PilotInput
                    aria-label="Fizetési határidő"
                    type="date"
                    value={shownDue}
                    min={issueDate || undefined}
                    onChange={setDueDate}
                    disabled={busy || follows}
                    title={
                      follows
                        ? "Kártyás fizetés: azonnal esedékes, a határidő a számla kelte."
                        : undefined
                    }
                  />
                </PilotFormField>
              ) : null}
            </div>
            {follows ? (
              <p className="text-xs text-pilot-grey-500">
                Kártyás fizetés: azonnal esedékes, a fizetési határidő a számla
                kelte.
              </p>
            ) : null}

            {delivery !== "NONE" ? (
              <label className="flex items-center gap-2 text-sm text-pilot-grey-800">
                <input
                  type="checkbox"
                  aria-label="Elküldöm e-mailben"
                  checked={sending}
                  disabled={busy || delivery === "REQUIRED"}
                  onChange={(event) => onSendChange(event.target.checked)}
                />
                Elküldöm e-mailben
                {delivery === "REQUIRED" ? (
                  <span className="text-xs text-pilot-grey-500">
                    (e-számlánál a kiküldés a kiállítás része)
                  </span>
                ) : null}
              </label>
            ) : null}

            {blocked ? (
              <p role="alert" className="text-sm text-rose-700">
                {blocked}
              </p>
            ) : null}
          </>
        )}

        <div className="flex gap-2">
          <PilotButton
            variant="primary"
            size="regular"
            disabled={
              busy ||
              !summary ||
              Boolean(loadError) ||
              Boolean(blocked) ||
              !dates?.ok
            }
            onClick={() => {
              if (!summary || !dates?.ok) return;
              onConfirm(
                {
                  issueDate: dates.value.issueDate,
                  fulfillmentDate: dates.value.fulfillmentDate,
                  dueDate: dates.value.dueDate,
                  fingerprint: summary.fingerprint,
                },
                sending,
              );
            }}
          >
            {busy ? "Kiállítás folyamatban…" : confirmLabel}
          </PilotButton>
          <PilotButton
            variant="secondary"
            size="regular"
            disabled={busy}
            onClick={onCancel}
          >
            Mégsem
          </PilotButton>
        </div>
        <p className="text-xs text-pilot-grey-500">
          Egy kiállított számla nem vonható vissza; javítani csak sztornóval
          vagy helyesbítő bizonylattal lehet.
        </p>
      </div>
    </div>
  );
}
