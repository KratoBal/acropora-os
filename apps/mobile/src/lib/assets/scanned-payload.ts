/**
 * MIT OLVASTUNK BE -- ÉS MELYIK AZONOSÍTÓ AZ.
 *
 * === A MÉRT HIBA, 2026-09-17 ===
 *
 * Balázs egy előre nyomtatott matricával nem tudta megtalálni a gépet, amire
 * fel van ragasztva. Három tünetet írt le, és MIND A HÁROM egy okból jött: a
 * telefonon KÉT KÜLÖN azonosító-vonal fut, és egyik sem ismeri a másikat.
 *
 *   `assets/scanner.tsx`      a `qrToken`-t várta: uuid, 128 bites véletlen,
 *                             amit a rendszer minden eszköznek ad. Egy
 *                             matricakód SOHA nem fog ennek látszani.
 *   `label-code-field.tsx`    a matricakódot várta, a TELJES beolvasott
 *                             szövegre illesztve.
 *
 * A szerveren VAN visszakereső végpont a matricakódra
 * (`GET service-assets/scan-label/:code`), és a telefon soha, egyetlen helyen
 * nem hívta. Nem hiányzó képesség volt, hanem be nem kötött.
 *
 * === AMIT A MATRICA VALÓJÁBAN HORDOZ, MÉRVE ===
 *
 * Ez a fájl eddig azért nem létezett, mert a `label-code-field.tsx` saját
 * kommentje kimondta: „a QR TARTALMÁNAK formáját nem ismerjük". 2026-09-17-én
 * Balázs lefényképezte mind a két köteget a telefon saját olvasójával, és a
 * képen ott áll, mit olvas ki belőlük:
 *
 *   régi köteg (2026-09-03, `J` előtag)   a QR tartalma:  `J3049`
 *   új   köteg (2026-09-17, `D` előtag)   a QR tartalma:  `D4204;D4204`
 *
 * A második a MI CSV-alakunk teljes sora. A `packages/types` `assetLabelCsv()`
 * két oszlopot ír (`kód;felirat`), és a két oszlop ugyanaz -- a nyomtató oldal
 * a második kötegnél a TELJES SORT tette a QR-be.
 *
 * Balázs döntése (idézve, 2026-09-17): „A D-nél sajnos rosszul nyomtattam ki és
 * ott kétszer van benne a kód. Nem szeretném újra nyomtatni, ezért jó lenne ha
 * így is működne." Ötven matrica van kinyomtatva; azok mennek a gépekre.
 */

/** A matricakód alakja: egy betű és négy számjegy. A tükör mintája. */
const KOD_ALAK = /^[A-Za-z][0-9]{4}$/;

export type ScannedLabel =
  /** Pontosan egy kód áll a payloadban (több előfordulás is lehet, de azonos). */
  | { kind: "code"; code: string }
  /**
   * TÖBB, EGYMÁSTÓL KÜLÖNBÖZŐ kód. NEM választunk: nem tudjuk, melyik a
   * matricáé, és a rossz választás FIZIKAI következménnyel jár -- másik gépre
   * kerül a címke. Ezért az elutasítás megnevezi mind a kettőt.
   */
  | { kind: "ambiguous"; codes: string[] }
  /** Nincs benne kód-alakú rész. */
  | { kind: "none" };

/**
 * A PAYLOADBAN ÁLLÓ MATRICAKÓD -- vagy a hiány oka.
 *
 * NEM A TELJES SZÖVEGRE ILLESZT, HANEM KINYER. A régi köteg a puszta kódot
 * hordozza, az új a teljes CSV sort; egy URL-be csomagolt kód ugyanígy átmegy.
 *
 * A DARABOLÁS NEM-ALFANUMERIKUS HATÁRON MEGY, és ez nem stílus: így egy
 * HOSSZABB futam (`X12345`) NEM adja ki az első öt karakterét kódként. A
 * körülnézés (lookbehind) ugyanezt oldaná meg, de a telefon futtatója nem
 * mindenhol ismeri -- ez az alak minden motoron ugyanazt adja.
 */
export function extractAssetLabelCode(payload: string): ScannedLabel {
  const darabok = payload.split(/[^A-Za-z0-9]+/).filter((d) => d !== "");
  const kodok = darabok
    .filter((d) => KOD_ALAK.test(d))
    .map((d) => d.toUpperCase());
  /**
   * AZ EGYEZÉST A NORMALIZÁLT ALAKON NÉZZÜK. Enélkül a `d4204;D4204`
   * KÉT különbözőnek látszana, és egy helyes matricát utasítanánk el.
   */
  const egyediek = [...new Set(kodok)];
  if (egyediek.length === 0) return { kind: "none" };
  if (egyediek.length === 1) return { kind: "code", code: egyediek[0]! };
  return { kind: "ambiguous", codes: egyediek };
}

/** Mennyit mutatunk meg a beolvasott szövegből a hibaüzenetben. */
export const BEOLVASOTT_MINTA_HOSSZ = 40;

/**
 * AMIT BEOLVASTUNK, EMBERI ALAKBAN -- hogy a hibaüzenet MEGMONDJA, mit látott.
 *
 * MIÉRT KELL: a két képernyő 2026-09-17-ig eldobta a payloadot, és csak annyit
 * mondott, hogy „nem az". Ha kiírta volna, mit olvasott, Balázs egy másodperc
 * alatt megmondta volna, mi van a matricán -- és nem kellett volna
 * lefényképeznie. Ez ugyanaz a hibafajta, amit a lapunk úgy hív, hogy a korlát
 * a saját kérdésedben van: a „nem matricakód" válasz a KÉRDÉSRŐL szólt, nem a
 * matricáról.
 *
 * A SORTÖRÉS ÉS A SOK SZÓKÖZ EGYETLENRE MEGY: egy többsoros payload
 * szétdobná a mondatot a képernyőn.
 */
export function describeScannedPayload(payload: string): string {
  const egy = payload.replace(/\s+/g, " ").trim();
  if (egy === "") return "(üres)";
  return egy.length <= BEOLVASOTT_MINTA_HOSSZ
    ? egy
    : `${egy.slice(0, BEOLVASOTT_MINTA_HOSSZ)}...`;
}

/**
 * A MATRICA-BEOLVASÁS ELUTASÍTÁSÁNAK MONDATA -- vagy `null`, ha van kód.
 *
 * KÉT KÜLÖN MONDAT, mert a teendő más: a `none` esetnél a kézi bevitel a
 * kiút, az `ambiguous` esetnél az, hogy megnézi, melyik kód áll a matricán.
 */
export function describeLabelScanFailure(
  payload: string,
  eredmeny: ScannedLabel,
): string | null {
  if (eredmeny.kind === "code") return null;
  const olvasott = describeScannedPayload(payload);
  if (eredmeny.kind === "ambiguous")
    return (
      `Több különböző kód van a beolvasott szövegben (${eredmeny.codes.join(", ")}), ` +
      `ezért nem választok helyetted. Írd be kézzel azt, ami a matricán áll. ` +
      `Beolvasva: ${olvasott}`
    );
  return `Ebben nincs matricakód (egy betű és négy szám). Írd be kézzel, vagy olvass be másikat. Beolvasva: ${olvasott}`;
}
