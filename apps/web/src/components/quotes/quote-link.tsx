"use client";

import {
  ConfirmDialog,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotInput,
} from "@acropora/ui";
import type { QuoteAcceptanceLinkDto, QuoteDetailDto } from "@acropora/types";
import { useEffect, useState } from "react";

import { quotesApi } from "@/lib/api/quotes";

const when = (iso: string) =>
  new Date(iso).toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    dateStyle: "short",
    timeStyle: "short",
  });

/**
 * AZ ELFOGADÓ LINK A PUBLIKÁLT VERZIÓHOZ (#1582 P4b). A link címe CSAK a
 * kiadáskor látszik (a rendszer a tokent nem tárolja); ha elveszett, új linket
 * kell kiadni, és a régi megszűnik. A kártya mondja meg, megnyitotta-e már az
 * ügyfél.
 */
export function QuoteAcceptanceLinkCard({
  token,
  quote,
  canManage,
}: {
  token: string;
  quote: QuoteDetailDto;
  canManage: boolean;
}) {
  const version = quote.versions.find((v) => v.status === "PUBLISHED") ?? null;
  const open = ["DRAFT", "SENT", "POSTPONED"].includes(quote.status);
  const [link, setLink] = useState<QuoteAcceptanceLinkDto | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** what the open question is about: both end the customer's live link */
  const [asking, setAsking] = useState<"revoke" | "replace" | null>(null);

  useEffect(() => {
    if (!version) return;
    let live = true;
    quotesApi
      .acceptanceLink(token, quote.id, version.id)
      .then((answer) => live && setLink(answer.link))
      .catch(() => live && setLink(null));
    return () => {
      live = false;
    };
  }, [quote.id, token, version]);

  if (!version) return null;

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message ? cause.message : failure,
      );
    } finally {
      setBusy(false);
    }
  };

  const issue = () =>
    run(async () => {
      const issued = await quotesApi.issueAcceptanceLink(
        token,
        quote.id,
        version.id,
      );
      setLink(issued);
      setAddress(`${window.location.origin}${issued.path}`);
      setCopied(false);
    }, "A link nem adható ki.");

  const revoke = () =>
    run(async () => {
      await quotesApi.revokeAcceptanceLink(token, quote.id, version.id);
      setLink(null);
      setAddress(null);
    }, "A link nem vonható vissza.");

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <PilotCard>
      <PilotCardHeader title={`Elfogadó link (v${version.versionNumber})`} />
      <div className="space-y-3 p-5 text-sm">
        {address ? (
          <div className="space-y-2">
            <p className="text-xs text-pilot-amber-700">
              A link címe csak most látszik. Másold ki és küldd el az ügyfélnek;
              ha elveszett, adj ki újat (a régi akkor megszűnik).
            </p>
            <div className="flex gap-2">
              <div className="flex-1">
                <PilotInput
                  aria-label="Az elfogadó link címe"
                  value={address}
                  readOnly
                />
              </div>
              <PilotButton
                variant="secondary"
                size="action"
                onClick={() => void copy()}
              >
                {copied ? "Kimásolva" : "Másolás"}
              </PilotButton>
            </div>
          </div>
        ) : null}
        {link ? (
          <p className="text-pilot-grey-700">
            Élő link, érvényes eddig: {when(link.expiresAt)}.{" "}
            {link.firstOpenedAt
              ? `Az ügyfél megnyitotta: ${when(link.firstOpenedAt)}.`
              : "Az ügyfél még nem nyitotta meg."}
          </p>
        ) : (
          <p className="text-pilot-grey-600">
            Ehhez a verzióhoz nincs élő link. A linken az ügyfél bejelentkezés
            nélkül megnézheti és elfogadhatja az ajánlatot.
          </p>
        )}
        {error ? (
          <p role="alert" className="text-xs text-pilot-red-700">
            {error}
          </p>
        ) : null}
        {canManage && open ? (
          <div className="flex gap-2">
            <PilotButton
              size="action"
              disabled={busy}
              onClick={() => (link ? setAsking("replace") : void issue())}
            >
              {link ? "Új link kiadása" : "Link kiadása"}
            </PilotButton>
            {link ? (
              <PilotButton
                variant="ghost"
                size="action"
                disabled={busy}
                onClick={() => setAsking("revoke")}
              >
                Link visszavonása
              </PilotButton>
            ) : null}
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={asking !== null}
        title={
          asking === "replace"
            ? "Új linket adsz ki az ügyfélnek?"
            : "Visszavonod az ügyfél linkjét?"
        }
        consequence="Az ügyfélnél lévő link azonnal megszűnik: a megnyitása hibát ad, és nem fogadható el rajta az ajánlat."
        recovery={
          asking === "replace"
            ? "Az új link címét most kapod meg; azt kell elküldeni az ügyfélnek."
            : "Később új linket adhatsz ki, de az új címmel, amit újra el kell küldeni."
        }
        confirmLabel={
          asking === "replace" ? "Új link kiadása" : "Link visszavonása"
        }
        busy={busy}
        onConfirm={() => {
          const action = asking;
          setAsking(null);
          void (action === "replace" ? issue() : revoke());
        }}
        onCancel={() => setAsking(null)}
      />
    </PilotCard>
  );
}
