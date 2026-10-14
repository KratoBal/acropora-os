"use client";
import { Alert } from "@acropora/ui";
import {
  recommendationBlocks,
  type AquariumMeasurementOccasion,
  type MeasurementRecommendationSegment,
  type MeasurementRecommendationView,
} from "@acropora/types";
import { Fragment, useCallback, useEffect, useState } from "react";

import { PilotBadge, PilotButton } from "@/components/pilot/pilot-ui";
import { aquariumsApi } from "@/lib/api/aquariums";

/** Egy sor darabjai: szöveg, és a termék neve link a webshop lapjára. */
function Segments({
  parts,
}: {
  parts: readonly MeasurementRecommendationSegment[];
}) {
  return (
    <>
      {parts.map((segment, index) =>
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
    </>
  );
}

/**
 * A szöveg, ahogy a vevő látja, tagolva (Balázs, 2026-10-14): a Vélemény, a
 * Javaslat és az Ajánlott termékek fejléc, bekezdések, lista
 * (`recommendationBlocks`). A termék neve link a webshop lapjára, új fülön; a
 * jelöltlistán kívüli azonosító piros, link nélkül (`danger`): jóváhagyni így
 * nem lehet, a szerver is megállítja. Egy régi, tagolatlan szöveg egy bekezdés.
 */
export function RecommendationText({
  segments,
}: {
  segments: readonly MeasurementRecommendationSegment[];
}) {
  return (
    <div className="space-y-2 text-sm leading-6 text-pilot-grey-800">
      {recommendationBlocks(segments).map((block, index) =>
        block.kind === "heading" ? (
          <h4 key={index} className="pt-1 font-semibold text-pilot-grey-900">
            {block.text}
          </h4>
        ) : block.kind === "list" ? (
          <ul key={index} className="list-disc space-y-1 pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Segments parts={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                <Segments parts={line} />
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
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

  /**
   * "No recommendation yet" arrives as an EMPTY body, not as `null`: the API
   * returns null, Nest sends nothing, and the client hands back `undefined`.
   * Every check below is `view !== null`, so an undefined view counted as a
   * recommendation and the first `view.draftText` took the whole page down
   * (Balázs, 2026-10-09, on every measurement, as production had none yet).
   */
  const show = (next: MeasurementRecommendationView | null | undefined) => {
    setView(next ?? null);
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
          Vélemény – Javaslat – Ajánlott termékek
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
              <span className="mt-1 block text-xs text-amber-700">
                A jóváhagyott szöveg más akvárium ajánlásához mintaként az
                AI-hoz kerül: ne írj bele nevet vagy cégnevet.
              </span>
            </label>
          ) : null}
          <div>
            <p className="text-xs text-pilot-grey-500">Előnézet</p>
            <RecommendationText segments={view.draftSegments} />
          </div>
          {view.malformedReference ? (
            <p className="text-xs text-red-700">
              A szövegben hibás alakú termék-hivatkozás áll (egy {"{{"} vagy{" "}
              {"}}"} maradt). A helyes alak {"{{termek:azonosító}}"}; amíg így
              marad, nem hagyható jóvá.
            </p>
          ) : null}
          {view.unknownProductIds.length ? (
            <p className="text-xs text-red-700">
              {view.unknownProductIds.length} termék-hivatkozás nincs a jelöltek
              között: javítsd vagy töröld, különben nem hagyható jóvá.
            </p>
          ) : null}
          {view.unverifiedProductIds.length ? (
            // Balázs, 2026-10-12 12:42 UTC: a csak saját adattal alátámasztott
            // hatást a jóváhagyó lássa; a jóváhagyást nem tiltja
            <p className="text-xs text-amber-800">
              Független forrás nem erősíti meg ezeknek a termékeknek a
              vízhatását, csak a saját adatunk állítja:{" "}
              {view.unverifiedProductIds
                .map(
                  (id) =>
                    view.candidates.find((c) => c.productId === id)?.name ?? id,
                )
                .join(", ")}
              . Jóváhagyás előtt nézd meg, megállja-e a helyét.
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
                      ? candidate.unverified
                        ? "JEV, csak saját adat, nincs független megerősítése"
                        : "JEV"
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
                  (!changed &&
                    (view.unknownProductIds.length > 0 ||
                      view.malformedReference)) ||
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
