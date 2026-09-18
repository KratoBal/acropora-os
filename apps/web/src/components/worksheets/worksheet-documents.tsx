"use client";

import type { WorksheetDocumentSummary } from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { worksheetsApi } from "@/lib/api/worksheets";
import { ServiceDocumentGallery } from "@/components/service/service-document-gallery";
import { splitWorksheetDocuments } from "./worksheet-issued-sheet";
import {
  ServicePanel,
  ServicePanelHeading,
} from "@/components/service/service-detail-chrome";

/**
 * A MUNKALAP CSATOLMANYAI A WEBES LAPON.
 *
 * === A MERT HIANY, 2026-09-17 ===
 *
 * Balazs szava: "a feltoltott fenykepek sehol nem jelnnek meg. marmint nem
 * tudom megnezni se a mobil appban se a weben."
 *
 * A munkalap webes reszletlapjan a "documents" szo EGYSZER SEM fordult elo:
 * nem szakasz-javitas volt, hanem szakasz-hiany. A vegpontok
 * (`GET :id/documents` es `GET :id/documents/:documentId`) 2026-09-03 ota
 * allnak, es a webes lap egyiket sem hivta -- a helyszinrol feltoltott fenykep
 * SEHOL nem latszott.
 *
 * === A GALERIA KOZOS KOMPONENS, NEM MASOLAT ===
 *
 * A `components/service/service-document-gallery.tsx` murena munkaja
 * (2026-09-17, a hibajegy lapjara), es kifejezetten azert all a kozos mappaban,
 * hogy a munkalap is hasznalhassa. A csempek, az objektum-URL kezelese, a
 * korlatozott parhuzamossag es a nagyitas mind ott all -- itt csak a HIVAS.
 *
 * === TORLES ITT NINCS, ES EZ MERES, NEM MULASZTAS ===
 *
 * A munkalapon NINCS torlo vegpont (a controlleren `Post`, ket `Get` es egy
 * `Patch` all, `Delete` nem). A galeria ezert `onDelete` NELKUL hivodik: a jog
 * hianya ott a FUGGVENY hianya, nem egy `false` zaszlo -- igy a galeria nem tud
 * "torol, de le van tiltva" allapotba kerulni, es nem igerunk olyan gombot,
 * ami a szerveren nem letezik.
 */
export function WorksheetDocuments({
  worksheetId,
  token,
  canView,
}: {
  worksheetId: string;
  token: string;
  canView: boolean;
}) {
  const [items, setItems] = useState<WorksheetDocumentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      try {
        const response = await worksheetsApi.documents(
          token,
          worksheetId,
          signal,
        );
        setItems(response.items);
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        /**
         * A HIBA NEM UGYANAZ, MINT AZ URES LISTA. Egy kozos "nincs csatolmany"
         * mondat azt ALLITANA, hogy nincs -- holott ilyenkor csak nem tudjuk,
         * es a kezelo hiaba varna.
         */
        setError(
          cause instanceof Error
            ? cause.message
            : "A csatolmányok nem tölthetők be.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, token, worksheetId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!canView) return null;

  const { issued, attachments } = splitWorksheetDocuments(items);

  /**
   * A KET SZAKASZ UGYANAZT A GALERIAT ES UGYANAZT A LETOLTESI UTAT HASZNALJA.
   *
   * A szetvalasztas a MEGJELENITESROL szol, nem az elerésről: a kiadott lap ma
   * is letoltheto a meglevo vegponton at, es ez a valtozas azt NEM irja at.
   */
  const galeria = (sorok: WorksheetDocumentSummary[], ures: string) => (
    <ServiceDocumentGallery
      items={sorok}
      loadBlob={(documentId) =>
        worksheetsApi.downloadDocument(token, worksheetId, documentId)
      }
      onDownload={(item) => void mentes(item)}
      emptyText={ures}
    />
  );

  return (
    <>
      {/*
        A KIADOTT LAP SAJAT SZAKASZT KAP (acrobot dontese, 2026-09-18).

        KET INDOK: a csatolmany az, amit VALAKI FELTOLTOTT, a lap az, amit a
        RENDSZER ADOTT KI -- egy listaban a felhasznalo nem tudja megmondani,
        melyik a hiteles peldany, es epp erre a fajlra fog a partner hivatkozni.
        A masodik merve van: a munkalap-oldal nem ad torles-gombot, tehat ez
        volt az EGYETLEN fajl a panelben, amit nem lehet eltavolitani.

        A SZAKASZ AKKOR IS ALL, HA MEG URES: piszkozat lapnal meg nincs kiadott
        peldany, es a mondat megmondja, mikor lesz. Elrejtve a felhasznalo nem
        tudna, hova fog kerulni.
      */}
      {/*
        A HIBA EGYSZER ALL, A KET SZAKASZ FOLOTT -- ES EZT EGY MEGLEVO ALLITAS
        KENYSZERITETTE KI.

        Eloszor mind a ket panelbe betettem, es a "betoltesi hibat
        megkulonbozteti az ures listatol" teszt kipirosodott: ket azonos szoveg
        allt a kepernyon. Egy lekeres bukott el, tehat EGY mondat jar rola --
        ket panel meg nem ket hiba.
      */}
      {error ? (
        <p className="mb-3 text-sm font-medium text-rose-600">{error}</p>
      ) : null}
      <ServicePanel>
        <ServicePanelHeading title="A kiadott munkalap" />
        {error ? null : loading ? (
          <p className="text-sm text-dusk-500">A kiadott lap töltődik…</p>
        ) : (
          galeria(
            issued,
            "Ez a munkalap még nincs lezárva, ezért kiadott példány sem készült róla.",
          )
        )}
      </ServicePanel>
      <ServicePanel>
        <ServicePanelHeading title="Csatolmányok" />
        {error ? null : loading ? (
          <p className="text-sm text-dusk-500">A csatolmányok töltődnek…</p>
        ) : (
          galeria(
            attachments,
            "Ehhez a munkalaphoz még nincs fénykép vagy fájl csatolva.",
          )
        )}
      </ServicePanel>
    </>
  );

  /**
   * A LETOLTES UGYANAZT A BLOBOT HASZNALJA, amit a galeria a csempehez: egy
   * masodik keres ugyanazert a fajlert ket letoltest jelentene ugyanarra a
   * gombnyomasra.
   */
  async function mentes(item: WorksheetDocumentSummary) {
    try {
      const blob = await worksheetsApi.downloadDocument(
        token,
        worksheetId,
        item.id,
      );
      const url = URL.createObjectURL(blob);
      const horgony = document.createElement("a");
      horgony.href = url;
      horgony.download = item.fileName;
      horgony.click();
      /**
       * AZ OBJEKTUM-URL-T VISSZA KELL VONNI, kulonben a bongeszo a LAP
       * ELETERE megtartja a blobot a memoriaban. A hiba nema: a letoltes
       * mukodik, a bongeszo lassul.
       */
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A csatolmány nem tölthető le.",
      );
    }
  }
}
