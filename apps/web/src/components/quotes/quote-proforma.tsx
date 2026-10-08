"use client";

import {
  Alert,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
} from "@acropora/ui";
import type { QuoteDetailDto } from "@acropora/types";
import { useState } from "react";

import { quotesApi } from "@/lib/api/quotes";

import { errorText } from "./quote-format";

const STATUS: Record<string, string> = {
  DRAFT: "vázlat",
  ISSUING: "kiállítás alatt",
  ISSUED: "kiállítva",
  ISSUE_FAILED: "kiállítás sikertelen",
};

/** "40.00" -> "40" */
const percent = (value: string) => value.replace(/\.?0+$/, "");

/**
 * A FIZETÉSI ÜTEMEZÉS ÉS A DÍJBEKÉRŐK (#1582 P7). Elfogadott ajánlaton a
 * mérföldkövenként egy díjbekérő-vázlat készíthető; a kiállítás a számlázás
 * oldalán történik, innen semmi nem megy ki.
 */
export function QuoteMilestonesCard({
  token,
  quote,
  canPrepare,
  onChanged,
}: {
  token: string;
  quote: QuoteDetailDto;
  canPrepare: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = quote.versions.find((v) => v.id === quote.acceptedVersionId);
  if (quote.status !== "ACCEPTED" || !version || !version.milestones.length)
    return null;
  const proformaOf = (milestoneId: string) =>
    version.proformas.find((p) => p.milestoneId === milestoneId) ?? null;

  const prepare = async (milestoneId: string) => {
    setBusy(milestoneId);
    setError(null);
    try {
      await quotesApi.proformaDraft(token, quote.id, milestoneId);
      onChanged();
    } catch (cause) {
      setError(errorText(cause, "A díjbekérő nem készíthető el."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <PilotCard>
      <PilotCardHeader title="Fizetési ütemezés" />
      <div className="space-y-3 p-5">
        {error ? (
          <Alert variant="danger" title="Hiba történt" description={error} />
        ) : null}
        {version.milestones.map((m) => {
          const proforma = proformaOf(m.id);
          return (
            <PilotDataRow
              key={m.id}
              label={`${m.label} (${percent(m.percent)}%)`}
              value={
                proforma ? (
                  <a
                    className="text-sm font-medium text-pilot-aqua-700 underline"
                    href={`/penzugy/szamlazas/${encodeURIComponent(proforma.invoiceId)}`}
                  >
                    Díjbekérő ({STATUS[proforma.status] ?? proforma.status})
                  </a>
                ) : canPrepare ? (
                  <PilotButton
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => void prepare(m.id)}
                  >
                    Díjbekérő előkészítése
                  </PilotButton>
                ) : (
                  "nincs díjbekérő"
                )
              }
            />
          );
        })}
        <p className="text-xs text-pilot-grey-600">
          A díjbekérő vázlatként készül, ÁFA-kulcsonként egy sorral; kiállítani
          a Számlázásban lehet.
        </p>
      </div>
    </PilotCard>
  );
}
