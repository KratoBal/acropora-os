import type { AssetCreateForm, AssetCreatePayload } from "./asset-create";

/**
 * EGY ELAKADT ESZKOZ-FELVITEL VISSZAOLVASASA SZERKESZTHETO URLAPPA.
 *
 * === MIERT KELL EGYALTALAN ===
 *
 * A sorban allo felvitel torzse SZOVEGKENT all a keszuleken (`payload_json`).
 * Ha a szerver elutasitotta (tipikusan matricakod-utkozes, 409), a szerelo
 * javitani szeretne rajta -- ahhoz viszont a torzset vissza kell alakitani
 * urlappa, kitoltve azzal, amit annak idejen beirt.
 *
 * === A TORZS NEM MEGBIZHATO BEMENET, ES EZ NEM ELMELETI ===
 *
 * A `payload_json` egy adatbazis-oszlop tartalma, amit egy KORABBI verzio irt
 * oda. Egy azota megvaltozott alak, egy felig irt sor vagy egy kezzel
 * belenyult ertek ugyanugy elofordulhat. Ezert minden mezot ellenorzunk, es a
 * fuggveny `null`-t ad, ha a torzs nem eszkoz-felvitel.
 *
 * A KOTELEZO MEZOK HIANYA `null`, A VALASZTHATOKE URES SZOVEG. A kettot nem
 * mossuk ossze: tulajdonos vagy nev nelkul nincs mit szerkeszteni (az urlap
 * ures lenne, es a mentes ugyis elbukna), egy hianyzo gyarto viszont csak egy
 * ures mezo.
 */

function szoveg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function assetFormFromPayload(payload: unknown): AssetCreateForm | null {
  if (typeof payload !== "object" || payload === null) return null;
  const row = payload as Partial<AssetCreatePayload> & Record<string, unknown>;

  const ownerType = row.ownerType;
  const ownerId = szoveg(row.ownerId);
  if (ownerType !== "CUSTOMER" && ownerType !== "SUPPLIER") return null;
  if (!ownerId) return null;

  const name = szoveg(row.name);
  if (!name) return null;

  const kind = row.kind;
  if (typeof kind !== "string" || !kind) return null;

  /**
   * A NAPOK SZAMBOL SZOVEGGE. Az urlap szoveget kezel (a billentyuzet azt ad),
   * a torzs szamot hordoz. Ami nem veges szam, az URES mezo lesz, nem "NaN":
   * egy "NaN" felirat a mezoben ugy nez ki, mint egy ertek, es a szerelo
   * megprobalna kijavitani ahelyett, hogy beirna a helyeset.
   */
  const interval =
    typeof row.serviceIntervalDays === "number" &&
    Number.isFinite(row.serviceIntervalDays)
      ? String(row.serviceIntervalDays)
      : "";

  return {
    owner: { type: ownerType, id: ownerId },
    unitId: szoveg(row.departmentId),
    name,
    kind: kind as AssetCreateForm["kind"],
    manufacturer: szoveg(row.manufacturer),
    model: szoveg(row.model),
    serialNumber: szoveg(row.serialNumber),
    inventoryNumber: szoveg(row.inventoryNumber),
    labelCode: szoveg(row.labelCode),
    installedAt: szoveg(row.installedAt),
    interval,
  };
}

/**
 * A TAROLT SZOVEGBOL URLAP, EGY LEPESBEN.
 *
 * A `JSON.parse` KIVETELT DOB egy romlott soron, es az itt all el, nem a
 * kepernyon: a hivo `null`-t kap, es azt mondja meg a szerelonek, hogy ezt a
 * felvitelt nem tudja megnyitni -- ahelyett, hogy a keperno osszeomlana egy
 * olyan hibaval, ami a JSON-rol szol, es a szerelonek semmit nem mond.
 */
export function assetFormFromPayloadJson(
  payloadJson: string,
): AssetCreateForm | null {
  try {
    return assetFormFromPayload(JSON.parse(payloadJson));
  } catch {
    return null;
  }
}
