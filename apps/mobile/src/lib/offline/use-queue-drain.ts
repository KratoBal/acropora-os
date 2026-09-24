import { useEffect, useRef, useState } from "react";

import {
  createAsset,
  updateAsset,
  uploadAssetDocuments,
  type CreateAssetInput,
} from "@/lib/api/assets";
import {
  addWorksheetLine,
  createWorksheet,
  uploadWorksheetDocuments,
  type CreateWorksheetInput,
} from "@/lib/api/worksheets";
import {
  createServiceJob,
  uploadServiceJobPhotos,
  type CreateServiceJobInput,
} from "@/lib/api/service-jobs";
import { createAquarium, type CreateAquariumInput } from "@/lib/api/aquariums";
import { readQueuedWorksheetLine } from "@/lib/worksheets/worksheet-line";
import { ApiError } from "@/lib/api/client";

import { readQueuedAssetUpdate } from "./asset-update-queue";
import { drainOfflineQueue } from "./drain-offline-queue";
import type { SyncQueueRow } from "./sync-queue";
import { readPhotoPayload } from "./queue-order";
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
            if (row.operation === "update") return modositastKuld(row);
            /**
             * A FAJTAK KIMERITOEN, NEM VISSZAESESSEL -- ES EZ EGY CSAPDAT ZAR BE.
             *
             * Eddig `if`-lanc allt itt, a vegen orizetlen visszaeses: "minden
             * mas eszkoz-felvitel". Egy UJ fajta felvetele a listara (most epp
             * a `service-job`) igy CSENDBEN az eszkoz-vegpontra kuldte volna a
             * sorait -- a szerver egy jegy torzsebol probalt volna eszkozt
             * csinalni.
             *
             * A `switch` + `never` alak ezt FORDITASI hibava teszi: aki a
             * kovetkezo fajtat felveszi, a fordítótól kapja meg a kerdest,
             * nem a szerelotol a helyszinen.
             */
            switch (row.entityType) {
              case "worksheet":
                return munkalapotKuld(row);
              case "worksheet-line":
                return tetelKuld(row);
              case "service-job":
                return jegyetKuld(row);
              case "aquarium":
                return akvariumotKuld(row);
              case "asset":
                break;
              default: {
                const soha: never = row.entityType;
                throw new Error(`Ismeretlen sor-fajta: ${String(soha)}`);
              }
            }
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
    /**
     * A FAJTAK KIMERITOEN, NEM VISSZAESESSEL -- UGYANAZ A CSAPDA, MINT A
     * FELVITELEKNEL, EGY FUGGVENNYEL LEJJEBB.
     *
     * 2026-09-16-ig itt `if`-lanc allt: ami nem munkalap, az ESZKOZKENT ment
     * fel. A `service-job` sorok felvetele utan ez azt jelentette volna, hogy
     * egy JEGY azonositojaval hivjuk az eszkoz-dokumentum vegpontot -- es a
     * hiba nema lett volna (letezo eszkoz azonositojara akar sikerulhetne is).
     *
     * A `switch` + `never` alak ugyanugy forditasi hibava teszi a kovetkezo
     * fajta felvetelet, mint a felviteli agon.
     */
    switch (row.entityType) {
      case "worksheet":
        await uploadWorksheetDocuments(row.entityId, { files });
        break;
      case "service-job":
        await uploadServiceJobPhotos(row.entityId, files);
        break;
      case "asset":
        // A FAJTAT A SZERVER DONTI EL, A FAJL BAJTJAIBOL (2026-09-22 ota).
        //
        // ITT KORABBAN `type: "OTHER"` ALLT, es ez a hivohely a legfontosabb a
        // harombol: az offline sor a HELYSZINEN keszult kepeket viszi fel,
        // amikor ujra van halozat. Amig az `OTHER` ment vele, a partner epp
        // azokat a fenykepeket nem latta, amikert a fajta letezik.
        await uploadAssetDocuments(row.entityId, { files });
        break;
      case "worksheet-line":
        /**
         * TETEL ALA NEM MEGY KEP, ES EZ NEM MULASZTAS: a fenykep a
         * MUNKALAPHOZ tartozik, nem egy soranak. Ilyen sort ma semmi nem tesz
         * a sorba -- ha megis keletkezne, az hiba, es 422-kent EMBERRE var.
         * Az eszkoz-vegpontra kuldeni csendben rossz helyre vinne.
         */
        return {
          httpStatus: 422,
          error:
            "A munkalap tétele alá nem tehető fénykép, ezért ezt a sort nem küldjük el.",
        };
      case "aquarium":
        /**
         * NINCS AKVARIUM-FENYKEP EBBEN A KORBEN, UGYANAZERT, MINT A TETELNEL:
         * a `canOwnPhotos("aquarium")` hamis (lasd `sync-queue.ts`), tehat a
         * `queue-runner.ts` ma sosem enged ide fenykep-sort. Ha megis
         * keletkezne, az hiba, es 422-kent EMBERRE var -- nem az eszkoz-
         * vegpontra menne csendben.
         */
        return {
          httpStatus: 422,
          error:
            "Az akvárium alá nem tehető fénykép, ezért ezt a sort nem küldjük el.",
        };
      default: {
        const soha: never = row.entityType;
        throw new Error(`Ismeretlen kép-gazda: ${String(soha)}`);
      }
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
 * EGY ESZKOZ-MODOSITAS FELKULDESE A SORBOL.
 *
 * === AMI ITT MAS, MINT A HAROM FELVITELNEL: NINCS UJ AZONOSITO ===
 *
 * A felviteleknel a valasz hozza a szerver-oldali azonositot, es az lep at a
 * varraton. Itt a celpont MAR letezett, tehat nincs mit atadni: az `entityId`
 * mar a soron all, es a valasz nem mond ujat rola.
 *
 * === AZ ELAVULT `expectedUpdatedAt` NEM HIBA, ES EZ AZ EGESZ SZELET ALAPJA ===
 *
 * A sorban allo torzs azt a verziot nevezi meg, amit a SZERELO latott -- ami
 * ora- vagy naphosszat allhatott a telefonon. A szerver 2026-09-04 ota nem a
 * verziot hasonlitja, hanem azt nezi, hogy a KOZBEN tortent esemenyek
 * UGYANAZOKAT A MEZOKET erintettek-e (`asset-field-conflict.ts`). Egy tegnapi
 * szerkesztes tehat ma is felmegy, ha kozben senki nem nyult UGYANAHHOZ a
 * mezohoz.
 *
 * Ha megis ugyanahhoz nyultak, a szerver 409-et ad, azt a `decideDrain`
 * KONFLIKTUSNAK sorolja, es a sor emberre var. Ez helyes: ilyenkor nem
 * ujraprobalni kell, hanem eldonteni, MELYIK ERTEK MARADJON -- es azt a
 * kepernyot a kovetkezo szelet hozza.
 */
async function modositastKuld(row: SyncQueueRow): Promise<{
  httpStatus: number | null;
  error: string | null;
}> {
  const payload = readQueuedAssetUpdate(row.payloadJson);
  if (payload === null) {
    /**
     * 422, VAGYIS KONFLIKTUS: ember kell hozza. Egy ertelmezhetetlen torzs
     * ujraprobalva ORokke ugyanezt adna, es a sor csendben porogne.
     */
    return {
      httpStatus: 422,
      error: "A módosítás sora értelmezhetetlen, ezért nem küldjük el.",
    };
  }
  if (row.entityId === null) {
    /**
     * EZ NEM ALLHAT ELO A MAI IRASI UTON (modositast csak MEGLEVO eszkozre
     * lehet inditani, es a sorba tetel oda is irja az azonositot), de a mezo
     * tipusa megengedi. Az ag ezert VAN: egy jovobeli hivo, aki elfelejti
     * kitolteni, itt egy mondatot kap, nem egy `null` erteku URL-t.
     */
    return {
      httpStatus: 422,
      error: "A módosítás sorához nem tartozik eszköz, ezért nem küldjük el.",
    };
  }
  try {
    await updateAsset(row.entityId, payload.patch);
    return { httpStatus: 200, error: null };
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
 * EGY HIBAJEGY FELKULDESE A SORBOL.
 *
 * UGYANAZ AZ ALAK, MINT A MUNKALAPE, es ez nem veletlen: mind a ketto UJ
 * entitast hoz letre, tehat a szerver azonositoja itt lep at a varraton. A jegy
 * ala kerulo fenykep (a kovetkezo darab) epp erre var -- ha az `entityId`-t
 * eldobnank, azt a kepet semmi nem tudna megcimezni, es a hiba NEMA lenne: a
 * sor kiurul, a jelentes zold.
 *
 * A TORZSBEN AZ `originAssetId` UTAZIK, nem a partner es a helyszin: azokat a
 * SZERVER vezeti le az eszkozbol. A telefon nem is tudna helyesen kitolteni --
 * szallitoi eszkoznel a jegy partnere a szallito TUKOR-sora, ami a partner
 * belso reszlete.
 */
async function jegyetKuld(row: SyncQueueRow): Promise<{
  httpStatus: number | null;
  error: string | null;
  entityId?: string | null;
}> {
  try {
    const letrejott = await createServiceJob({
      ...(JSON.parse(row.payloadJson) as CreateServiceJobInput),
      clientOperationId: row.id,
    });
    return { httpStatus: 201, error: null, entityId: letrejott.id };
  } catch (cause) {
    return {
      httpStatus: cause instanceof ApiError ? cause.status : null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * EGY AKVARIUM FELKULDESE A SORBOL -- AZ UGYFELLEL EGYUTT.
 *
 * UGYANAZ AZ ALAK, MINT A MUNKALAPE ES A JEGYE: UJ entitast hoz letre, tehat
 * a szerver azonositoja itt lep at a varraton. A `payload` mar hordozza a
 * `newCustomer` mezot is (ha a felvitel ugyfel-tulajdonu es helyben vitte
 * fel az ugyfelet) -- a szerver EGYETLEN hivasban kezeli mind a kettot, a
 * `clientOperationId` pedig VISSZAADOTT MEGLEVO akvariumot ad egy
 * megismetelt kuldesre, nem masodikat hoz letre sem az akvariumbol, sem az
 * ugyfelbol.
 */
async function akvariumotKuld(row: SyncQueueRow): Promise<{
  httpStatus: number | null;
  error: string | null;
  entityId?: string | null;
}> {
  try {
    const letrejott = await createAquarium({
      ...(JSON.parse(row.payloadJson) as CreateAquariumInput),
      clientOperationId: row.id,
    });
    return { httpStatus: 201, error: null, entityId: letrejott.id };
  } catch (cause) {
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
