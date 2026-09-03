import { useEffect, useRef, useState } from "react";

import { createAsset, type CreateAssetInput } from "@/lib/api/assets";
import { ApiError } from "@/lib/api/client";

import { drainOfflineQueue } from "./drain-offline-queue";
import { describeQueueRun } from "./queue-runner";

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
            try {
              await createAsset(
                JSON.parse(row.payloadJson) as CreateAssetInput,
              );
              return { httpStatus: 201, error: null };
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
        setUzenet(describeQueueRun(report));
      } finally {
        fut.current = false;
      }
    })();
  }, [isOnline]);

  return uzenet;
}
