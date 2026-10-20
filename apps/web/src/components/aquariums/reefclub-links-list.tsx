"use client";

import { Alert } from "@acropora/ui";
import { useCallback, useEffect, useState } from "react";

import { PilotButton } from "@/components/pilot/pilot-ui";
import { aquariumsApi, type ReefClubCustomerLink } from "@/lib/api/aquariums";

import { formatMoment } from "./reefclub-time";

type Links =
  | { state: "loading" }
  | { state: "ready"; links: ReefClubCustomerLink[] }
  | { state: "failed"; message: string };

/** Kit szüntetett meg egy összekötést, ahogy a szerver tárolja. */
function endedByText(link: ReefClubCustomerLink): string {
  if (link.endedBy === "ACCOUNT") return "a vevő szüntette meg";
  if (link.endedBy === "SHOP") return "a bolt szüntette meg";
  return "megszűnt";
}

/** A vevő értesítése az új összekötésről; a hiányát a kolléga is látja. */
function noticeText(link: ReefClubCustomerLink): string {
  if (link.noticeSentAt)
    return `Értesítés elküldve: ${formatMoment(link.noticeSentAt)}`;
  if (link.noticeFailed)
    return "A vevő NEM kapott értesítést (minden küldés elbukott).";
  return "Értesítés: még nem ment el.";
}

/**
 * A VEVŐ REEFCLUB-ÖSSZEKÖTÉSEI ÉS MEGSZÜNTETÉSÜK (kártya reefclub-kod-gomb, 2. rész): a
 * kolléga látja, melyik ReefClub-fiók kapcsolódik a vevőhöz, és megszüntetheti, ha a vevő
 * nem ő csinálta. A megszüntetés kétlépéses (Megszüntetés, majd Igen), mert a fiók
 * elveszíti a vevő bolti akváriumait, és visszavonás nincs (csak új kóddal köthető újra). Csak az aktív linkhez
 * van gomb; a megszűntek előzményként állnak.
 */
export function ReefClubLinksList({
  token,
  customerId,
}: {
  token: string;
  customerId: string;
}) {
  const [links, setLinks] = useState<Links>({ state: "loading" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      aquariumsApi
        .reefClubLinks(token, customerId, signal)
        .then((found) => setLinks({ state: "ready", links: found }))
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError")
            return;
          setLinks({
            state: "failed",
            message:
              cause instanceof Error
                ? cause.message
                : "Az összekötések nem tölthetők be.",
          });
        }),
    [token, customerId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLinks({ state: "loading" });
    setConfirming(null);
    setError(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function end(linkId: string) {
    setEnding(linkId);
    setError(null);
    try {
      await aquariumsApi.endReefClubLink(token, customerId, linkId);
      setConfirming(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az összekötés nem szüntethető meg.",
      );
    } finally {
      setEnding(null);
    }
    // a lista a szerver állapotát mutassa akkor is, ha a megszüntetés elbukott
    // (például közben a vevő maga megszüntette)
    await load();
  }

  return (
    <div className="flex flex-col gap-2" data-testid="reefclub-links">
      <p className="text-sm font-semibold">ReefClub-összekötések</p>

      {links.state === "loading" ? (
        <p className="text-sm text-dusk-500">Betöltés…</p>
      ) : null}
      {links.state === "failed" ? (
        <Alert
          variant="danger"
          title="Az összekötések nem tölthetők be"
          description={links.message}
        />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="A megszüntetés nem sikerült"
          description={error}
        />
      ) : null}

      {links.state === "ready" && links.links.length === 0 ? (
        <p className="text-sm text-dusk-600">
          A vevőhöz még nem kapcsolódik ReefClub-fiók.
        </p>
      ) : null}

      {links.state === "ready" && links.links.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {links.links.map((link) => (
            <li
              key={link.id}
              className="rounded-lg border border-dusk-200 p-3 text-sm"
              data-testid={`reefclub-link-${link.id}`}
            >
              <p className="font-medium">
                {link.accountEmail}{" "}
                <span
                  className={
                    link.status === "ACTIVE"
                      ? "text-emerald-700"
                      : "text-dusk-500"
                  }
                >
                  {link.status === "ACTIVE" ? "aktív" : "megszűnt"}
                </span>
              </p>
              <p className="text-dusk-600">
                Összekötve: {formatMoment(link.createdAt)}
                {link.status === "ENDED" && link.endedAt
                  ? `, ${endedByText(link)}: ${formatMoment(link.endedAt)}`
                  : ""}
              </p>
              <p className="text-dusk-600">{noticeText(link)}</p>

              {link.status === "ACTIVE" ? (
                confirming === link.id ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="text-dusk-700">
                      Biztosan megszünteted? A fiók ezután nem látja a vevő
                      bolti akváriumait. A vevő új kóddal újra összeköthet.
                    </p>
                    <div className="flex gap-2">
                      <PilotButton
                        type="button"
                        disabled={ending === link.id}
                        onClick={() => void end(link.id)}
                      >
                        {ending === link.id
                          ? "Megszüntetés…"
                          : "Igen, megszüntetem"}
                      </PilotButton>
                      <PilotButton
                        type="button"
                        variant="secondary"
                        disabled={ending === link.id}
                        onClick={() => setConfirming(null)}
                      >
                        Mégsem
                      </PilotButton>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <PilotButton
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setError(null);
                        setConfirming(link.id);
                      }}
                    >
                      Összekötés megszüntetése
                    </PilotButton>
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
