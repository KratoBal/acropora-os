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
  /**
   * AMIT A SZERELO LATOTT, MIELOTT ATIRTA -- mezonkent, nyers alakban.
   *
   * === MIERT KELL, ES MIERT NEM ELEG NELKULE A FRISS ALLAPOT ===
   *
   * Egy elakadt modositas feloldasakor a kerdes az, hogy MAS is hozzanyult-e
   * ugyanahhoz a mezohoz. Ezt CSAK harom ertekbol lehet eldonteni: amit a
   * szerelo latott, amit beirt, es ami MOST all a szerveren.
   *
   * Ket ertekbol (beirt es mostani) nem: ha a szerelo Wilorol Grundfosra irta
   * at a gyartot es RAJTA KIVUL SENKI nem nyult hozza, a friss eszkozon meg
   * mindig Wilo all -- ez ELTERESNEK latszik, holott nincs mit eldonteni. Egy
   * ilyen kerdesre a szerelo zavaraban a masikat valaszthatja, es a SAJAT
   * javitasa tunik el csendben.
   *
   * === MIERT NYERS ERTEK, ES NEM A KIIRT SZOVEG ===
   *
   * A helyszinnel a torzs AZONOSITOT visz, a kepernyo NEVET mutat. Ha itt a nev
   * allna, egy atnevezett helyszin valtozasnak latszana, holott ugyanaz a
   * helyszin.
   *
   * === MIERT NEM KOTELEZO ===
   *
   * A 2026-09-04 delelottjen sorba tett modositasokon ez a mezo nincs ott. Egy
   * kotelezo mezo azokat OLVASHATATLANNA tenne, es a szerelo munkaja veszne el
   * egy formai valtozas miatt. Hianyzo alapertek eseten a feloldo keperno
   * MINDEN mezorol kerdez -- tobbet kerdez a kelletenel, de semmit nem hallgat
   * el.
   */
  base?: QueuedAssetUpdateBase;
}

/** A szerkesztes kezdetekor lathato ertekek, nyers alakban. */
export interface QueuedAssetUpdateBase {
  status?: string;
  criticality?: string;
  /** A helyszin AZONOSITOJA, nem a neve. `null`, ha nem volt beallitva. */
  departmentId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  inventoryNumber?: string | null;
  description?: string | null;
  notes?: string | null;
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
    /**
     * AZ ALAPERTEK HIANYA NEM TESZI OLVASHATATLANNA A SORT. A mezo 2026-09-04
     * delutanjan keletkezett, es a korabbi sorokon nincs ott: ha itt
     * megkovetelnenk, azok a felvitelek egy formai valtozas miatt vesznenek el.
     */
    return {
      assetName: p.assetName,
      patch: patch as UpdateAssetInput,
      ...(p.base ? { base: p.base as QueuedAssetUpdateBase } : {}),
    };
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
    /**
     * AZ ALAPERTEKNEL A KORABBI NYER, ES EZ FORDITVA VAN, MINT A TORZSNEL.
     *
     * A torzsnel a kesobbi szandek az igaz. Az alapertek viszont nem szandek,
     * hanem MEGFIGYELES: azt rogziti, mit LATOTT a szerelo, mielott hozzanyult.
     * Ha a masodik szerkesztes felulirna, akkor a sajat, mar modositott ertekunk
     * lenne az "eredeti" -- es a feloldas azt hinne, hogy a mezot senki nem
     * bantotta.
     */
    ...(previous.base || next.base
      ? { base: { ...next.base, ...previous.base } }
      : {}),
  };
}
