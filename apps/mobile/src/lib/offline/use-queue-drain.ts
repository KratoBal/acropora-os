import { useEffect, useRef, useState } from "react";

import {
  createAsset,
  uploadAssetDocuments,
  type CreateAssetInput,
} from "@/lib/api/assets";
import { ApiError } from "@/lib/api/client";

import { drainOfflineQueue } from "./drain-offline-queue";
import type { SyncQueueRow } from "./sync-queue";
import { readPhotoPayload } from "./photo-queue";
import { describeQueueRun, describeUnresolvedRecordings } from "./queue-runner";

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
            try {
              const letrejott = await createAsset(
                JSON.parse(row.payloadJson) as CreateAssetInput,
              );
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
  try {
    await uploadAssetDocuments(row.entityId, {
      // UGYANAZ A FAJTA, MINT A KEPERNYORE VETT KEPNEL (`assets/[id].tsx`): a
      // szamla es a garancialevel az irodabol kerul fel, a helyszini kep OTHER.
      type: "OTHER",
      files: [{ uri: payload.uri, name: payload.name, type: payload.type }],
    });
    return { httpStatus: 201, error: null };
  } catch (cause) {
    return {
      httpStatus: cause instanceof ApiError ? cause.status : null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
