"use client";

import { Alert, ConfirmDialog, PilotButton } from "@acropora/ui";
import type {
  BillingDocumentDetail,
  BillingIssuingCheck,
} from "@acropora/types";
import { useState } from "react";

import { billingDocumentsApi } from "@/lib/api/billing-documents";

/**
 * A KIÁLLÍTÁS, AMI NEM ZÁRULT LE (ISSUING): az ellenőrzés és a kivezetés
 * felülete (kártya 38e9271d). Két lépés, ahogy a szerver is:
 *
 *   1. „Kiállítás ellenőrzése”: a szerver lekérdezi a Számlázz.hu-t (csak
 *      olvas), és javaslatot ad. Az eredmény mondata változatlanul látszik.
 *   2. A javaslat gombja (rögzítés a Számlázz.hu számával, vagy vissza
 *      vázlatba) megerősítés után megy: a szerver MÉG EGYSZER lekérdez, és
 *      csak ugyanarra a javaslatra ír.
 *
 * Ahol a szerver „nem tudjuk”-ot mond, NINCS végrehajtó gomb: a felület nem
 * talál ki műveletet, amit a szerver nem javasolt.
 */
type Proposal = Exclude<BillingIssuingCheck["action"], "NONE">;

const BUTTON_LABEL: Record<Proposal, (check: BillingIssuingCheck) => string> = {
  RECORD_ISSUED: (check) => `Rögzítés kiállítottként (${check.invoiceNumber})`,
  BACK_TO_DRAFT: () => "Vissza vázlatba",
};

function dialogCopy(check: BillingIssuingCheck & { action: Proposal }) {
  if (check.action === "RECORD_ISSUED")
    return {
      title: `Rögzíted a(z) ${check.invoiceNumber} számot ehhez a bizonylathoz?`,
      consequence:
        "A Számlázz.hu igazolta, hogy ez a bizonylat már ki van állítva. A rendszer ezzel a számmal kiállítottnak jelöli, és könyveli a készletet.",
      recovery:
        "Új kiállítás nem indul. A rögzítés nem vonható vissza; ha mégis hiba van benne, a bizonylat sztornózható.",
      confirmLabel: "Rögzítem",
    };
  return {
    title: "Visszateszed a bizonylatot vázlatba?",
    consequence:
      "A Számlázz.hu nem ismeri ezt a bizonylatot, tehát nincs kiállított számla. A bizonylat újra szerkeszthető és kiállítható lesz.",
    recovery:
      "A visszatétel nem vonható vissza, a kiállítás ezután a szokásos megerősítéssel indul.",
    confirmLabel: "Visszateszem",
  };
}

export function BillingIssuingCheckPanel({
  detail,
  token,
  canManage,
  onDone,
}: {
  detail: Pick<BillingDocumentDetail, "id" | "status">;
  token: string;
  /** `finance.manage`: a szerver is ezt kéri. */
  canManage: boolean;
  onDone: (detail: BillingDocumentDetail) => void;
}) {
  const [check, setCheck] = useState<BillingIssuingCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (detail.status !== "ISSUING") return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      setCheck(await billingDocumentsApi.issuingCheck(token, detail.id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az ellenőrzés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    if (!check || check.action === "NONE") return;
    setBusy(true);
    setError(null);
    try {
      const resolved = await billingDocumentsApi.issuingResolve(
        token,
        detail.id,
        {
          expectedUpdatedAt: check.expectedUpdatedAt,
          action: check.action,
          invoiceNumber: check.invoiceNumber,
        },
      );
      setCheck(null);
      onDone(resolved);
    } catch (cause) {
      // a szerver mondata (409: közben változott) marad, az ellenőrzést újra kell futtatni
      setCheck(null);
      setError(
        cause instanceof Error ? cause.message : "A rögzítés nem sikerült.",
      );
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const proposal: (BillingIssuingCheck & { action: Proposal }) | null =
    check && check.action !== "NONE"
      ? (check as BillingIssuingCheck & { action: Proposal })
      : null;

  return (
    <div className="flex flex-col gap-3">
      <Alert
        variant="danger"
        title="A kiállítás ellenőrzésre vár"
        description={
          canManage
            ? "A kiállítás elindult, de nem zárult le. Ne állíts ki újat: az ellenőrzés megnézi a Számlázz.hu-n, készült-e bizonylat."
            : "A kiállítás elindult, de nem zárult le. Az ellenőrzéshez pénzügyi kezelői jog kell."
        }
        action={
          canManage ? (
            <PilotButton
              variant="secondary"
              size="regular"
              disabled={busy}
              onClick={run}
            >
              Kiállítás ellenőrzése
            </PilotButton>
          ) : undefined
        }
      />
      {error ? <Alert variant="danger" title={error} /> : null}
      {check ? (
        <Alert
          variant="info"
          title={proposal ? "Az ellenőrzés javaslata" : "Nem tudjuk biztosan"}
          description={check.reason}
          action={
            proposal ? (
              <PilotButton
                variant="primary"
                size="regular"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                {BUTTON_LABEL[proposal.action](proposal)}
              </PilotButton>
            ) : undefined
          }
        />
      ) : null}
      {proposal ? (
        <ConfirmDialog
          open={confirming}
          busy={busy}
          {...dialogCopy(proposal)}
          onConfirm={resolve}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
