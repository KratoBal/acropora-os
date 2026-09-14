import { useEffect, useRef } from "react";

import { listAssetOwners } from "@/lib/api/assets";
import { listPartnerUnits } from "@/lib/api/partners";

import {
  decideFormCachePrefetch,
  PREFETCH_UNIT_PARTNER_LIMIT,
} from "./form-cache-prefetch";
import {
  readCachedAssetOwners,
  rememberAssetOwners,
  rememberPartnerUnits,
} from "./asset-form-cache";

/**
 * AZ ESZKOZ-URLAP KET LISTAJA A KESZULEKRE, MIELOTT SZUKSEG LENNE RAJUK.
 *
 * A dontes a `form-cache-prefetch.ts`-ben all, es ott is van tesztelve. Itt
 * csak a vegrehajtas van: egy hivas a tulajdonosokra, majd partnerenkent egy az
 * alegysegekre.
 *
 * === A HIBAT ELNYELJUK, ES EZ SZANDEKOS ===
 *
 * Ugyanaz a szabaly, mint az `asset-form-cache.ts` fejleceben: a masolat
 * KENYELEM, a sor BIZONYITEK. Egy elhasalt elotoltes nem szolhat bele a
 * fokepernyobe, mert a kollega ott epp mast csinal, es az urlap sajat maga is
 * megprobalja majd a lekerest.
 *
 * === MIERT NEM FUT KETSZER EGYSZERRE ===
 *
 * Ugyanaz az ok, mint a sor kiuritesenel: a fokepernyo tobbszor is
 * ujrarenderelodhet, es ket parhuzamos futas ugyanazt toltene le ketszer. A
 * `fut` jelzo a FUTAS idejere all, nem a munkamenetre: ha a masolat hat oranal
 * regebbi lesz, a kovetkezo inditas ujra elindithatja.
 */
export function useFormCachePrefetch(input: {
  online: boolean;
  authenticated: boolean;
  assetsManage: boolean;
}): void {
  const fut = useRef(false);
  const { online, authenticated, assetsManage } = input;

  useEffect(() => {
    if (fut.current) return;
    if (!online || !authenticated || !assetsManage) return;
    fut.current = true;
    let ervenyes = true;
    void (async () => {
      try {
        const mentett = await readCachedAssetOwners();
        const dontes = decideFormCachePrefetch({
          online,
          authenticated,
          assetsManage,
          ownersSyncedAt: mentett.syncedAt,
          now: new Date(),
        });
        if (!dontes.run || !ervenyes) return;

        const owners = await listAssetOwners();
        if (!ervenyes) return;
        await rememberAssetOwners(owners.items);

        /**
         * A HATAR FELETT NEM TOLTUNK ALEGYSEGET, es a tulajdonos-lista MAR
         * MENTVE VAN. Ez a sorrend a lenyeg: az eszkoz felvitelehez a
         * tulajdonos KOTELEZO, a helyszin nem. Ha tehat az alegysegekbol nem
         * jut ido vagy keret, a felvitel akkor is elvegezheto a pinceben.
         */
        if (owners.items.length > PREFETCH_UNIT_PARTNER_LIMIT) return;
        for (const owner of owners.items) {
          if (!ervenyes) return;
          if (owner.type !== "SUPPLIER") continue;
          try {
            const units = await listPartnerUnits(owner.id);
            if (!ervenyes) return;
            await rememberPartnerUnits(owner.id, units.items);
          } catch {
            // Egy partner alegysegei elhasalhatnak anelkul, hogy a tobbit
            // elvinnek: a kovetkezo partner ettol meg letoltheto.
          }
        }
      } catch {
        // Lasd a fejlecet: a masolat kenyelem, nem bizonyitek.
      } finally {
        fut.current = false;
      }
    })();
    return () => {
      ervenyes = false;
    };
  }, [online, authenticated, assetsManage]);
}
