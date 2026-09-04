import { useEffect, useRef, useState } from "react";

import {
  createAsset,
  uploadAssetDocuments,
  type CreateAssetInput,
} from "@/lib/api/assets";
import {
  addWorksheetLine,
  createWorksheet,
  uploadWorksheetDocuments,
  type CreateWorksheetInput,
} from "@/lib/api/worksheets";
import { readQueuedWorksheetLine } from "@/lib/worksheets/worksheet-line";
import { ApiError } from "@/lib/api/client";

import { drainOfflineQueue } from "./drain-offline-queue";
import type { SyncQueueRow } from "./sync-queue";
import { readPhotoPayload } from "./photo-queue";
import {
  describeQueueRun,
  describeStalled,
  describeUnresolvedRecordings,
} from "./queue-runner";

/**
 * A SOR KIURITESE, AMIKOR VISSZAJON A HALOZAT.
 *
 * === EZ AZ UTOLSO HIVASI HELY ===
 *
 * A dontesek, a tarolo, a futtato es a bekotes mind keszen alltak; ez a hook az,
 * ami MEGHIVJA oket. Amig nem letezett, a sor tudta a szabalyait, es senki nem
 * inditotta el -- a felvitelek a telefonon maradtak volna orokre.
 *
 * === MIERT NEM FUT TOBBSZOR EGYSZERRE ===
 *
 * A `fut` jelzo nelkul ket parhuzamos kiurites ugyanazt a sort kuldene el
 * ketszer, es a szerveren KET eszkoz keletkezne egy felvitelbol. A sor allapota
 * ezt reszben vedi (`syncing` nem kuldheto), de a vedelem ott az adatbazisban
 * van -- ket egyszerre indulo futas ugyanazt a sort olvashatna ki elotte.
 */
export function useQueueDrain(isOnline: boolean): string | null {
  const [uzenet, setUzenet] = useState<string | null>(null);
  const fut = useRef(false);

  useEffect(() => {
    if (!isOnline || fut.current) return;
    fut.current = true;
    void (async () => {
      try {
        const report = await drainOfflineQueue({
          send: async (row) => {
            if (row.operation === "upload-photo") return kepetKuld(row);
            if (row.entityType === "worksheet") return munkalapotKuld(row);
            if (row.entityType === "worksheet-line") return tetelKuld(row);
            try {
              const letrejott = await createAsset({
                ...(JSON.parse(row.payloadJson) as CreateAssetInput),
                /**
                 * A SOR AZONOSITOJA A SZERVER IDEMPOTENCIA-KULCSA IS.
                 *
                 * A sor a halozati hibat SZANDEKOSAN ujraprobalja, es epp ott
                 * lehet, hogy a szerver mar letrehozta az eszkozt, csak a
                 * valasz veszett el. A kulccsal az ujrakuldes a MEGLEVO
                 * eszkozt adja vissza; nelkule masodikat hozna letre, es a
                 * szerelo azt latna, hogy mindent ketszer rogzitett.
                 */
                clientOperationId: row.id,
              });
              /**
               * A SZERVER AZONOSITOJA ITT LEP AT A VARRATON. A sor a nyugtazas
               * utan torlodik, tehat ha ezt eldobnank, a mar sorban allo
               * fenykepeket semmi nem tudna megcimezni -- es a hiba nema
               * lenne: a sor kiurul, a jelentes zold.
               */
              return {
                httpStatus: 201,
                error: null,
                entityId: letrejott.id,
              };
            } catch (cause) {
              /**
               * A HTTP KOD ES A HALOZATI HIBA SZETVALASZTVA. A `null` azt
               * jelenti, hogy a keres el sem jutott a szerverig -- azt a sor
               * ujraprobalja. Egy valaszolt 4xx viszont NEM: azt a
               * `decideDrain` konfliktusnak sorolja, es emberre var.
               */
              return {
                httpStatus: cause instanceof ApiError ? cause.status : null,
                error: cause instanceof Error ? cause.message : String(cause),
              };
            }
          },
        });
        const mondatok = [
          describeQueueRun(report),
          describeStalled(report),
          describeUnresolvedRecordings(report),
        ].filter((m): m is string => m !== null);
        setUzenet(mondatok.length > 0 ? mondatok.join(" ") : null);
      } finally {
        fut.current = false;
      }
    })();
  }, [isOnline]);

  return uzenet;
}

/**
 * EGY FENYKEP FELKULDESE A MAR FELMENT ROGZITESHEZ.
 *
 * A HAROM ELUTASITAS KULON, mert mas a teendo:
 *
 *   ertelmezhetetlen payload -> 422, vagyis KONFLIKTUS: ember kell hozza, es
 *                               az ujraprobalas ugyanezt adna orokke.
 *   nincs meg az azonosito   -> halozati alak (`null`), vagyis UJRAPROBALHATO:
 *                               a rogzites felmehet egy kesobbi futasban.
 *   a szerver utasit el      -> a `decideDrain` besorolasa dont, ugyanugy,
 *                               mint a rogzitesnel.
 */
async function kepetKuld(row: SyncQueueRow): Promise<{
  httpStatus: number | null;
  error: string | null;
}> {
  const payload = readPhotoPayload(row.payloadJson);
  if (payload === null) {
    return {
      httpStatus: 422,
      error: "A fénykép sora értelmezhetetlen, ezért nem küldjük el.",
    };
  }
  if (row.entityId === null) {
    return {
      httpStatus: null,
      error: "A rögzítés még nem ment fel, a képnek nincs hova kerülnie.",
    };
  }
  const files = [{ uri: payload.uri, name: payload.name, type: payload.type }];
  try {
    /**
     * A GAZDA DONTI EL, MELYIK VEGPONTRA MEGY A KEP.
     *
     * A sor mar hordozza (`entityType`), tehat nem kell uj mezo a payloadba --
     * es a ket ut igy nem tud elcsuszni egymastol: egy munkalap-kep sosem
     * kerulhet egy eszkoz ala.
     */
    if (row.entityType === "worksheet") {
      await uploadWorksheetDocuments(row.entityId, { files });
    } else {
      await uploadAssetDocuments(row.entityId, {
        // A SZAMLA ES A GARANCIALEVEL AZ IRODABOL KERUL FEL; a helyszini kep
        // az eszkoznel OTHER, a munkalapnal PHOTO (a szerver alapertelmezese).
        type: "OTHER",
        files,
      });
    }
    return { httpStatus: 201, error: null };
  } catch (cause) {
    return {
      httpStatus: cause instanceof ApiError ? cause.status : null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * EGY MUNKALAP FELKULDESE A SORBOL.
 *
 * UGYANAZ A KULCS, MAS VEGPONT. A sor azonositoja megy fel
 * `clientOperationId` neven, tehat egy megszakadt kuldes ujrakuldese a MEGLEVO
 * lapot adja vissza. A `entityId` itt nem kell: fenykep ma csak eszkozhoz
 * tartozik, a munkalaphoz nem kotunk kepet a sorbol.
 */
async function munkalapotKuld(row: SyncQueueRow): Promise<{
  httpStatus: number | null;
  error: string | null;
  entityId?: string | null;
}> {
  try {
    const letrejott = await createWorksheet({
      ...(JSON.parse(row.payloadJson) as CreateWorksheetInput),
      clientOperationId: row.id,
    });
    /**
     * AZ AZONOSITO ITT LEP AT A VARRATON, ugyanugy, mint az eszkoznel. A sor a
     * nyugtazas utan torlodik: ha eldobnank, a lapra varo fenykepeket semmi nem
     * tudna megcimezni -- es a hiba NEMA lenne, mert a sor kiurul es a jelentes
     * zold marad.
     */
    return { httpStatus: 201, error: null, entityId: letrejott.id };
  } catch (cause) {
    /**
     * UGYANAZ A KETTEVALASZTAS, MINT AZ ESZKOZNEL: a `null` azt jelenti, hogy
     * a keres el sem jutott a szerverig -- azt a sor ujraprobalja. Egy
     * valaszolt 4xx viszont NEM: azt a `decideDrain` konfliktusnak sorolja.
     */
    return {
      httpStatus: cause instanceof ApiError ? cause.status : null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * EGY MUNKALAP-TETEL FELKULDESE A SORBOL.
 *
 * === AMIBEN ELTER A MASIK KETTOTOL ===
 *
 * Itt a GAZDA mar letezik: a lap azonositoja a soron all (`entityId`), es nem a
 * valaszbol keletkezik. Ezert nem is ad vissza `entityId`-t: nincs uj entitas,
 * amihez barmit cimezni kellene, es a `queue-runner.ts` ezt a `canOwnPhotos`
 * lekepezesbol tudja -- e nelkul minden felment tetel „azonosito nelkul
 * felment rogzitesnek" latszana.
 *
 * === A TETEL AZONOSITOJA A SOR KULCSA ===
 *
 * Nem a payloadbol jon, hanem a `row.id` mezobol, es ez a lenyeg: a szerver
 * EPP ERRE idempotens (`alreadyPresent`). Ha a valasz elveszik es a sor
 * ujrakuld, a MEGLEVO tetelt talalja meg. Ket kulon kulcs mellett az
 * ujrakuldes masodik tetelt hozna letre ugyanarrol a munkarol.
 *
 * === A KET ELUTASITAS KULON, MERT MAS A TEENDO ===
 *
 * Ertelmezhetetlen torzs vagy hianyzo gazda -> 422, vagyis KONFLIKTUS: ember
 * kell hozza, es az ujraprobalas ugyanezt adna orokke. Ezek a sorok NEM
 * keletkezhetnek a mai kodbol (a sorba tetel mind a kettot kitolti), es epp
 * ezert kell hangosnak lenniuk: ha megis eloall, az egy MASIK hiba nyoma, nem
 * halozati zaj.
 */
async function tetelKuld(row: SyncQueueRow): Promise<{
  httpStatus: number | null;
  error: string | null;
}> {
  const payload = readQueuedWorksheetLine(row.payloadJson);
  if (payload === null) {
    return {
      httpStatus: 422,
      error: "A tétel sora értelmezhetetlen, ezért nem küldjük el.",
    };
  }
  if (row.entityId === null) {
    return {
      httpStatus: 422,
      error: "A tételhez nem tartozik munkalap, ezért nincs hova felküldeni.",
    };
  }
  try {
    await addWorksheetLine(row.entityId, { id: row.id, ...payload });
    return { httpStatus: 201, error: null };
  } catch (cause) {
    /**
     * UGYANAZ A KETTEVALASZTAS, MINT A MASIK KETTONEL: a `null` azt jelenti,
     * hogy a keres el sem jutott a szerverig -- azt a sor ujraprobalja. Egy
     * valaszolt 409 viszont NEM: azt a `decideDrain` konfliktusnak sorolja, es
     * a tetelnel ez EGYET jelent -- a lap kozben lezarult.
     */
    return {
      httpStatus: cause instanceof ApiError ? cause.status : null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
