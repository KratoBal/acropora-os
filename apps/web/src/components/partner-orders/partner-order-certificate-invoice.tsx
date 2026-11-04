"use client";

import { Alert, ConfirmDialog, PilotButton } from "@acropora/ui";
import {
  formatMoney,
  hasPermission,
  PERMISSIONS,
  type MaintenanceInvoiceSummary,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { maintenanceInvoiceApi } from "@/lib/api/maintenance-invoice";

/**
 * EGY MEGRENDELÉSES TIG SZÁMLÁJA (kártya 88649353; Balázs, 2026-11-04 17:35-17:38 UTC: „legyen
 * számlázás gomb és ne kelljen hozzá feltölteni aláírt tig-et. Ha feltöltött tig nélkül nyom
 * valaki a számlázás gombra, akkor kapjon figyelmeztetést, hogy biztos e”).
 *
 * Ugyanaz az út, mint a munkalap Számla paneljén (`MaintenanceInvoicePanel`, ugyanazok a
 * végpontok): piszkozat, előnézet, kiállítás (pénzügyi joggal, NAV-megerősítéssel), letöltés.
 * A különbség a kapu: itt aláírt példány nélkül is számlázható, de akkor egy megerősítő ablak
 * kérdez, és a szerver csak a megerősítéssel (`acknowledgeUnsigned`) fogadja el.
 */
export function PartnerOrderCertificateInvoice({
  certificateId,
  certificateNumber,
  signed,
}: {
  certificateId: string;
  certificateNumber: string;
  signed: boolean;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canIssue = Boolean(
    session?.user && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );
  const [invoice, setInvoice] = useState<
    MaintenanceInvoiceSummary | null | undefined
  >(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUnsigned, setConfirmUnsigned] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);

  useEffect(() => {
    let live = true;
    maintenanceInvoiceApi
      .byCertificate(token, certificateId)
      // `?? null`: an empty answer is "no invoice yet", never an endless loading
      .then((found) => live && setInvoice(found ?? null))
      .catch((cause: unknown) => {
        if (!live) return;
        setInvoice(null);
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : "A számla adatai nem tölthetők be.",
        );
      });
    return () => {
      live = false;
    };
  }, [certificateId, token]);

  const run = async (
    action: () => Promise<MaintenanceInvoiceSummary>,
    fallback: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      setInvoice(await action());
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message ? cause.message : fallback,
      );
    } finally {
      setBusy(false);
      setConfirmUnsigned(false);
      setConfirmIssue(false);
    }
  };

  const draft = (acknowledgeUnsigned: boolean) =>
    run(
      () =>
        maintenanceInvoiceApi.draft(token, certificateId, {
          acknowledgeUnsigned,
        }),
      "A számla piszkozata nem készült el.",
    );

  const download = async () => {
    if (!invoice) return;
    setError(null);
    try {
      const blob = await maintenanceInvoiceApi.downloadPdf(token, invoice.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        invoice.status === "ISSUED" && invoice.invoiceNumber
          ? `szamla-${invoice.invoiceNumber}.pdf`
          : `szamla-elonezet-${certificateNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "A számla PDF-je nem tölthető le.",
      );
    }
  };

  if (invoice === undefined)
    return (
      <p className="mt-2 text-xs text-pilot-grey-500">Számla: betöltés…</p>
    );

  return (
    <div className="mt-3 space-y-2 border-t border-pilot-grey-100 pt-3">
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      {invoice === null ? (
        <PilotButton
          size="action"
          disabled={busy}
          onClick={() =>
            signed ? void draft(false) : setConfirmUnsigned(true)
          }
        >
          {busy ? "Számlázás…" : "Számlázás"}
        </PilotButton>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">
            Számla:{" "}
            {invoice.status === "ISSUED"
              ? (invoice.invoiceNumber ?? "kiállítva")
              : invoice.status === "ISSUING"
                ? "a kiállítás ellenőrzésre vár"
                : "piszkozat"}{" "}
            · {formatMoney(invoice.grossAmount, invoice.currency)}
          </p>
          {invoice.status === "ISSUING" ? (
            <Alert
              variant="danger"
              title="A kiállítás ellenőrzésre vár"
              description={
                invoice.issueNote ??
                "Ellenőrizd a Számlázz.hu-n, elkészült-e a számla."
              }
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {invoice.status !== "ISSUING" ? (
              <PilotButton
                variant="secondary"
                size="action"
                onClick={() => void download()}
              >
                {invoice.status === "ISSUED"
                  ? "Számla letöltése"
                  : "Előnézet letöltése"}
              </PilotButton>
            ) : null}
            {invoice.status === "DRAFT" ? (
              <>
                <PilotButton
                  size="action"
                  disabled={!invoice.issueEnabled || !canIssue || busy}
                  onClick={() => setConfirmIssue(true)}
                >
                  {busy ? "Kiállítás…" : "Kiállítás"}
                </PilotButton>
                {!invoice.issueEnabled ? (
                  <span className="text-xs text-pilot-grey-500">
                    A kiállítás még nincs bekapcsolva.
                  </span>
                ) : !canIssue ? (
                  <span className="text-xs text-pilot-grey-500">
                    A kiállításhoz pénzügyi jogosultság kell.
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          <ConfirmDialog
            open={confirmIssue}
            title={`Kiállítod a számlát (${formatMoney(invoice.grossAmount, invoice.currency)})?`}
            consequence="Valódi, a NAV-nak bejelentett számla készül a Számlázz.hu-n, pontosan a piszkozat tételeivel és összegével."
            recovery="Nem vonható vissza: egy kiállított számla csak sztornó számlával javítható."
            confirmLabel="Számla kiállítása"
            busy={busy}
            onConfirm={() =>
              void run(
                () => maintenanceInvoiceApi.issue(token, invoice.id),
                "A számla kiállítása nem sikerült.",
              )
            }
            onCancel={() => setConfirmIssue(false)}
          />
        </div>
      )}
      <ConfirmDialog
        open={confirmUnsigned}
        title={`${certificateNumber}: aláírt példány nélkül számlázod?`}
        consequence="Ehhez a teljesítési igazoláshoz még nincs feltöltve az aláírt példány. A számla piszkozata enélkül készül el."
        recovery="Az aláírt példány később is feltölthető; a piszkozat kiállításig nem megy ki."
        confirmLabel="Számlázom"
        busy={busy}
        onConfirm={() => void draft(true)}
        onCancel={() => setConfirmUnsigned(false)}
      />
    </div>
  );
}
