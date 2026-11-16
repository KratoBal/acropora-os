"use client";

import { useState } from "react";
import {
  formatMoney,
  type BillingIssueSummary,
  type MaintenanceInvoiceIssueResult,
  type MaintenanceInvoiceSummary,
} from "@acropora/types";

import { BillingIssueConfirmDialog } from "@/components/billing/billing-issue-confirm-dialog";
import { maintenanceInvoiceApi } from "@/lib/api/maintenance-invoice";

/**
 * THE TIG INVOICE'S "KIÁLLÍTÁS" THROUGH THE CONFIRMATION WINDOW (card 7ba97e0d, S3; Balázs 2026-11-11 11:12-11:20 UTC),
 * for both places a TIG invoice is issued: the worksheet's Számla panel and the order's certificate. The window shows
 * the buyer, the three (editable) dates, the payment method and the send address as the issue will send them;
 * "Elküldöm e-mailben" sends the issued invoice to that address. The summary loads on the click, not in an effect, as
 * on the webshop order.
 */
export function useMaintenanceInvoiceIssue({
  token,
  invoice,
  onIssued,
  onFailed,
}: {
  token: string;
  invoice: MaintenanceInvoiceSummary | null;
  onIssued: (result: MaintenanceInvoiceIssueResult) => void;
  /** The issue was refused or its outcome is unknown: the message, for the panel to show (and reload). */
  onFailed: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<BillingIssueSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [send, setSend] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!invoice) return;
    setSummary(null);
    setLoadError(null);
    setSend(false);
    setOpen(true);
    try {
      setSummary(await maintenanceInvoiceApi.issueSummary(token, invoice.id));
    } catch (cause) {
      setLoadError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A számla adatai nem tölthetők be.",
      );
    }
  };

  const dialog = invoice ? (
    <BillingIssueConfirmDialog
      open={open}
      title={`Kiállítod a számlát (${formatMoney(invoice.grossAmount, invoice.currency)})?`}
      consequence="Valódi, a NAV-nak bejelentett számla készül a Számlázz.hu-n, pontosan a piszkozat tételeivel és összegével. Nem vonható vissza: egy kiállított számla csak sztornó számlával javítható."
      confirmLabel="Számla kiállítása"
      summary={summary}
      loadError={loadError}
      recipients={summary?.buyerEmail ? [summary.buyerEmail] : []}
      delivery="OPTIONAL"
      send={send}
      onSendChange={setSend}
      busy={busy}
      onConfirm={(confirmation, sendIt) => {
        setBusy(true);
        void maintenanceInvoiceApi
          .issue(token, invoice.id, { ...confirmation, send: sendIt })
          .then(onIssued, (cause: unknown) =>
            onFailed(
              cause instanceof Error && cause.message
                ? cause.message
                : "A számla kiállítása nem sikerült.",
            ),
          )
          .finally(() => {
            setBusy(false);
            setOpen(false);
          });
      }}
      onCancel={() => setOpen(false)}
    />
  ) : null;

  return { start, busy, dialog };
}

/** What happened to the letter after the issue (S3): sent, or why not; the invoice is made either way. */
export function InvoiceMailNotice({
  mail,
}: {
  mail: MaintenanceInvoiceIssueResult["mail"];
}) {
  if (!mail) return null;
  return (
    <p
      role="status"
      data-testid="invoice-mail"
      className={
        mail.sent
          ? "text-sm text-pilot-grey-700"
          : "rounded-lg bg-pilot-amber-50 p-3 text-sm text-pilot-amber-700"
      }
    >
      {mail.sent
        ? `A számla elment: ${mail.to}.`
        : `A számla elkészült, de a levél nem ment ki (${mail.to}): ${mail.error} A Számlázás oldalon újra elküldhető.`}
    </p>
  );
}
