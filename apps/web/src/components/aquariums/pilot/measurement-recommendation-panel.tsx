"use client";
import { Alert } from "@acropora/ui";
import type {
  AquariumMeasurementOccasion,
  MeasurementRecommendationSegment,
  MeasurementRecommendationView,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { PilotBadge, PilotButton } from "@/components/pilot/pilot-ui";
import { aquariumsApi } from "@/lib/api/aquariums";

/**
 * A szöveg, ahogy a vevő látja: a termék neve link a webshop lapjára. A
 * jelöltlistán kívüli azonosító piros, link nélkül (`danger`): jóváhagyni
 * így nem lehet, a szerver is megállítja.
 */
export function RecommendationText({
  segments,
}: {
  segments: readonly MeasurementRecommendationSegment[];
}) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-6 text-pilot-grey-800">
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : segment.name === null ? (
          <span
            key={index}
            data-testid="ismeretlen-termek"
            className="rounded bg-red-50 px-1 font-semibold text-red-700"
          >
            ismeretlen termék ({segment.productId})
          </span>
        ) : segment.url ? (
          <a
            key={index}
            href={segment.url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-pilot-aqua-700 underline"
          >
            {segment.name}
          </a>
        ) : (
          <span key={index} className="font-semibold">
            {segment.name}
          </span>
        ),
      )}
    </p>
  );
}

/**
 * A VÍZMÉRÉSI TERMÉKAJÁNLÁS BLOKKJA egy alkalom alatt (kártya 2b3983e1): a
 * kérés, a szerkeszthető vázlat az előnézettel, és a jóváhagyás. A vevő csak
 * a jóváhagyott szöveget látja (a portálon és a PDF-en); a vázlat belső.
 */
export function MeasurementRecommendationPanel({
  token,
  aquariumId,
  occasion,
  canManage,
}: {
  token: string;
  aquariumId: string;
  occasion: AquariumMeasurementOccasion;
  canManage: boolean;
}) {
  const [view, setView] = useState<MeasurementRecommendationView | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = (next: MeasurementRecommendationView | null) => {
    setView(next);
    setText(next?.draftText ?? "");
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      show(
        await aquariumsApi.measurementRecommendation(
          token,
          aquariumId,
          occasion.id,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az ajánlás nem tölthető be.",
      );
    } finally {
      setLoading(false);
    }
  }, [aquariumId, occasion.id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<MeasurementRecommendationView>) => {
    setBusy(true);
    setError(null);
    try {
      show(await action());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const request = () =>
    run(() =>
      aquariumsApi.requestMeasurementRecommendation(
        token,
        aquariumId,
        occasion.id,
      ),
    );

  const changed = view !== null && text.trim() !== (view.draftText ?? "");

  const save = () =>
    run(() =>
      aquariumsApi.saveMeasurementRecommendation(
        token,
        aquariumId,
        occasion.id,
        {
          text,
          expectedUpdatedAt: view!.updatedAt,
        },
      ),
    );

  /** A jóváhagyás a mentett vázlatra szól: egy szerkesztett szöveg előbb mentődik. */
  const approve = () =>
    run(async () => {
      const saved = changed
        ? await aquariumsApi.saveMeasurementRecommendation(
            token,
            aquariumId,
            occasion.id,
            { text, expectedUpdatedAt: view!.updatedAt },
          )
        : view!;
      return aquariumsApi.approveMeasurementRecommendation(
        token,
        aquariumId,
        occasion.id,
        { expectedUpdatedAt: saved.updatedAt },
      );
    });

  return (
    <section
      data-testid="ajanlas-blokk"
      className="space-y-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-pilot-grey-900">
          Termékajánlás
        </h3>
        {view ? (
          view.status === "APPROVED" ? (
            <PilotBadge variant="success">
              Jóváhagyva
              {view.approvedByName ? ` · ${view.approvedByName}` : ""}
            </PilotBadge>
          ) : (
            <PilotBadge variant="amber">Vázlat: a vevő nem látja</PilotBadge>
          )
        ) : null}
      </header>
      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}
      {loading ? (
        <p className="text-xs text-pilot-grey-500">Betöltés…</p>
      ) : !view ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-pilot-grey-500">
            Ehhez a méréshez még nincs ajánlás. Az AI a célsávon kívüli
            értékekből ír vázlatot; a vevő csak a jóváhagyott szöveget látja.
          </p>
          {canManage ? (
            <PilotButton onClick={() => void request()} disabled={busy}>
              {busy ? "Kérés…" : "Ajánlás kérése"}
            </PilotButton>
          ) : null}
        </div>
      ) : (
        <>
          {canManage ? (
            <label className="block">
              <span className="text-xs text-pilot-grey-500">
                Vázlat (a termékre {"{{termek:azonosító}}"} hivatkozik; a nevet
                és a linket a rendszer rakja be)
              </span>
              <textarea
                aria-label="Az ajánlás szövege"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={6}
                className="mt-1 w-full rounded-lg border border-pilot-grey-200 bg-white px-3 py-2 text-sm text-pilot-grey-900"
              />
            </label>
          ) : null}
          <div>
            <p className="text-xs text-pilot-grey-500">Előnézet</p>
            <RecommendationText segments={view.draftSegments} />
          </div>
          {view.unknownProductIds.length ? (
            <p className="text-xs text-red-700">
              {view.unknownProductIds.length} termék-hivatkozás nincs a jelöltek
              között: javítsd vagy töröld, különben nem hagyható jóvá.
            </p>
          ) : null}
          {view.candidates.length ? (
            <details className="text-xs text-pilot-grey-600">
              <summary className="cursor-pointer">
                Jelöltek ({view.candidates.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {view.candidates.map((candidate) => (
                  <li key={candidate.productId}>
                    <code>{candidate.productId}</code> · {candidate.name} ·{" "}
                    {candidate.basis === "JEV"
                      ? "JEV"
                      : candidate.effects.length
                        ? "kategória"
                        : "kategória, gyártói állítás nélkül"}
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="text-xs text-pilot-grey-500">
              Ehhez a kéréshez nem volt termékjelölt, ezért az ajánlás termék
              nélkül készült.
            </p>
          )}
          {view.status === "DRAFT" && view.approvedText ? (
            <div className="rounded-xl bg-pilot-grey-50 px-3 py-2">
              <p className="text-xs text-pilot-grey-500">
                A vevő most ezt látja (az előző jóváhagyás):
              </p>
              <RecommendationText segments={view.approvedSegments} />
            </div>
          ) : null}
          {canManage ? (
            <div className="flex flex-wrap justify-end gap-2">
              <PilotButton
                variant="ghost"
                onClick={() => void request()}
                disabled={busy}
              >
                Új vázlat kérése
              </PilotButton>
              <PilotButton
                variant="secondary"
                onClick={() => void save()}
                disabled={busy || !changed}
              >
                Mentés
              </PilotButton>
              <PilotButton
                onClick={() => void approve()}
                disabled={
                  busy ||
                  !text.trim() ||
                  (!changed && view.unknownProductIds.length > 0) ||
                  (!changed && view.status === "APPROVED")
                }
              >
                Jóváhagyás
              </PilotButton>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
