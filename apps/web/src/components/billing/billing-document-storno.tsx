"use client";

import { Alert, ConfirmDialog, PilotButton } from "@acropora/ui";
import {
  BILLING_STORNABLE_TYPES,
  type BillingDocumentCancellation,
  type BillingDocumentDetail,
} from "@acropora/types";
import { useState } from "react";

import { billingDocumentsApi } from "@/lib/api/billing-documents";
import { formatDay } from "./billing-document-table";
import { useBillingDocumentPdf } from "./use-billing-document-pdf";

/**
 * KÍNÁLJUK-E A SZTORNÓT (számlázási brief, 1. pont): kiállított, számmal bíró,
 * sztornózható típusú bizonylaton, amíg nincs sztornója. Az elutasított sztornó
 * (`ISSUE_FAILED`) újrapróbálható, a szerver ott folytatja; a folyamatban lévő
 * és a kész sztornó nem.
 *
 * AMIT SZÁNDÉKOSAN NEM DÖNTÜNK EL ITT: az előleget levonó végszámla. Azt a
 * szerver tudja (409, „előbb a végszámlát sztornózd”), és a felület az ő
 * mondatát mutatja, nem találja ki előre.
 */
export function stornoOffered(
  detail: Pick<
    BillingDocumentDetail,
    "status" | "documentNumber" | "documentType" | "cancellation"
  >,
): boolean {
  return (
    detail.status === "ISSUED" &&
    Boolean(detail.documentNumber) &&
    BILLING_STORNABLE_TYPES.has(detail.documentType) &&
    (!detail.cancellation || detail.cancellation.state === "ISSUE_FAILED")
  );
}

/**
 * A SZTORNÓ GOMBJA ÉS MEGERŐSÍTÉSE, a részleteken és a szerkesztő „Kiállítva”
 * sávjában ugyanaz. A kérdés és a két gomb a brief szó szerinti szövege; a
 * szerver hibája (409 az okkal) a gomb alatt marad, amíg újra nem próbálják.
 */
export function useBillingStorno(
  token: string,
  onDone: (detail: BillingDocumentDetail) => void,
) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await billingDocumentsApi.storno(token, id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A sztornó nem sikerült.",
      );
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return { open, setOpen, busy, error, confirm };
}

export function BillingStornoDialog({
  number,
  open,
  busy,
  onConfirm,
  onCancel,
}: {
  number: string;
  open: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={`Biztos, hogy sztornózod a(z) ${number} számlát?`}
      consequence="A Számlázz.hu sztornó bizonylatot állít ki rá, saját számmal; amit a számla a készletből levett, az visszakerül."
      recovery="A sztornó nem vonható vissza: ha mégis kell a számla, újat kell kiállítani."
      confirmLabel="Sztornózom"
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export function BillingStornoButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <PilotButton
      variant="danger"
      size="regular"
      disabled={disabled}
      onClick={onClick}
    >
      Sztornó
    </PilotButton>
  );
}

/**
 * A SZTORNÓ ÁLLAPOTA A RÉSZLETEKEN: a kész sztornó száma, kelte és PDF-je; a
 * Számlázz.hu felületén sztornózottnál csak a tény (PDF-et nem kínálunk, mert
 * nincs nálunk); a folyamatban lévőnél, hogy ellenőrzésre vár; az
 * elutasítottnál a hiba.
 */
export function BillingCancellationNotice({
  cancellation,
  documentId,
  token,
}: {
  cancellation: BillingDocumentCancellation;
  documentId: string;
  token: string;
}) {
  const pdf = useBillingDocumentPdf(token, "storno");

  if (cancellation.state === "ISSUING")
    return (
      <Alert
        variant="danger"
        title="A sztornó ellenőrzésre vár"
        description="A sztornó elindult, de a Számlázz.hu válasza nem érkezett meg: nézd meg a Számlázz.hu-n, mielőtt bármit újra próbálsz."
      />
    );
  if (cancellation.state === "ISSUE_FAILED")
    return (
      <Alert
        variant="danger"
        title="A sztornó nem sikerült"
        description={
          cancellation.error ?? "A Számlázz.hu nem állította ki a sztornót."
        }
      />
    );
  if (cancellation.source === "SZAMLAZZ")
    return (
      <Alert
        variant="info"
        title="Sztornózva a Számlázz.hu-n"
        description={`Ezt a számlát a Számlázz.hu felületén sztornózták${
          cancellation.issueDate
            ? `, ${formatDay(cancellation.issueDate)} keltével`
            : ""
        }. A sztornó bizonylat PDF-je nincs nálunk, a Számlázz.hu-n nézhető meg.`}
      />
    );

  const number = cancellation.stornoNumber ?? "sztornó";
  return (
    <>
      <Alert
        variant="info"
        title={`Sztornózva: ${number}`}
        description={`A sztornó bizonylat kelte: ${formatDay(cancellation.issueDate)}`}
        action={
          <div
            role="group"
            aria-label="A sztornó bizonylat PDF-je"
            className="flex flex-wrap gap-2"
          >
            <PilotButton
              variant="secondary"
              size="regular"
              onClick={() => pdf.view(documentId)}
              disabled={!cancellation.pdfAvailable || pdf.busy}
              title={
                cancellation.pdfAvailable
                  ? undefined
                  : "A sztornó PDF-je nem érhető el."
              }
            >
              Sztornó megtekintése
            </PilotButton>
            <PilotButton
              variant="secondary"
              size="regular"
              onClick={() => pdf.download(documentId, number)}
              disabled={!cancellation.pdfAvailable || pdf.busy}
              title={
                cancellation.pdfAvailable
                  ? undefined
                  : "A sztornó PDF-je nem érhető el."
              }
            >
              Sztornó PDF letöltése
            </PilotButton>
          </div>
        }
      />
      {pdf.error ? (
        <Alert
          variant="danger"
          title="A sztornó PDF-je nem érhető el"
          description={pdf.error}
        />
      ) : null}
    </>
  );
}
