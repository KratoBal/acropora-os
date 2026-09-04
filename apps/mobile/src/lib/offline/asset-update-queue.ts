/**
 * EGY SORBAN ALLO ESZKOZ-MODOSITAS TORZSE.
 *
 * === MIERT NEM MAGA A PATCH ALL A SORBAN ===
 *
 * A szervernek kuldott torzs CSAK a megvaltozott mezoket tartalmazza. Ha
 * valaki a helyszint irja at, a patchben egyetlen mezo all -- a NEV nem, mert
 * az nem valtozott. A sor-kepernyon viszont a szerelo az eszkozt keresi a
 * neven, es egy "nev nelkul" cimke ott hasznalhatatlan.
 *
 * A nevet ezert a sor KULON hordozza, a patch MELLETT. Beleirni a patchbe nem
 * lehet: az a szerveren ATIRNA a nevet, holott a szerelo hozza sem nyult.
 *
 * Ugyanaz az alak, mint a `photo-queue.ts` `PhotoPayload` tipusanal es a
 * `worksheet-line` sorainal: a sor torzse a KULDESHEZ es a MEGMUTATASHOZ
 * egyutt eleg, es egy olvaso fuggveny donti el, hogy ertelmes-e.
 */

import type { UpdateAssetInput } from "../assets/asset-fields";

export interface QueuedAssetUpdate {
  /** Az eszkoz neve, ahogy a szerelo latta. CSAK a sor-kepernyore. */
  assetName: string;
  /** A szervernek menő torzs. Ez es semmi mas megy fel. */
  patch: UpdateAssetInput;
}

/**
 * A SOR TORZSE MODOSITASKENT, VAGY `null`, HA NEM AZ.
 *
 * A `expectedUpdatedAt` megletet KULON nezi: e nelkul egy regi vagy serult sor
 * ugy menne fel, hogy a szerver nem tudna, melyik verziohoz kepest ir -- es
 * pont az a vedelem esne ki, amiert a mezo letezik.
 */
export function readQueuedAssetUpdate(json: string): QueuedAssetUpdate | null {
  try {
    const p = JSON.parse(json) as Partial<QueuedAssetUpdate>;
    if (typeof p.assetName !== "string") return null;
    const patch = p.patch as Partial<UpdateAssetInput> | undefined;
    if (!patch || typeof patch.expectedUpdatedAt !== "string") return null;
    return { assetName: p.assetName, patch: patch as UpdateAssetInput };
  } catch {
    return null;
  }
}

/**
 * KET SZERKESZTES UGYANARROL A VERZIOROL, EGY SORBAN.
 *
 * === MIERT OSSZEFESULES, ES MIERT NEM AZ EGYIK NYER ===
 *
 * A szerelo offline atirja a gyartot, ment, majd eszreveszi, hogy a helyszin is
 * rossz, es azt is atirja. A ket patch KULON mezokrol szol, mert mindketto a
 * gyorsitotarazott (regi) allapothoz kepest keszult: az elsoben a gyarto all, a
 * masodikban a helyszin.
 *
 * Ha a masodik FELULIRNA az elsot, a gyarto javitasa nyomtalanul eltunne. Ha a
 * masodikat ELDOBNANK, a helyszin javitasa tunne el. Egyik esetben sem hibazna
 * semmi, es a szerelo azt latna, hogy mentett.
 *
 * === UGYANARRA A MEZORE A KESOBBI NYER, ES EZ SEM IZLES ===
 *
 * Ha ugyanazt a mezot ketszer irta at, a MASODIK az, amit akar. Egy megorzott
 * elso ertek azt jelentene, hogy a javiast nem lehet visszavonni.
 *
 * A nevre ugyanez all: a frissebb olvasas all kozelebb ahhoz, amit a szerelo a
 * kepernyon lat.
 */
export function mergeQueuedAssetUpdate(
  previous: QueuedAssetUpdate,
  next: QueuedAssetUpdate,
): QueuedAssetUpdate {
  return {
    assetName: next.assetName,
    patch: { ...previous.patch, ...next.patch },
  };
}
