import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A KERET MINDEN OLYAN TABLAT SZAMOL, AMI A KOTETET FOGLALJA -- ES A LISTA A
 * SEMABOL JON.
 *
 * === MIERT KELL EGYALTALAN ===
 *
 * A keret EGY kotetrol szol. Ha egy uj tabla kimarad az osszegbol, a hiba
 * NEMA: minden feltoltesi ut a sajat, kisebb osszeget latja a hatar alatt, es
 * a lemez CSENDBEN telik be. Semmi nem hibazik, semmi nem pirosodik.
 *
 * 2026-09-14-ig ez pontosan igy allt: az osszeg KET helyen volt leirva, kezzel,
 * ket taggal -- es a harmadik gazda (a hibajegy) felvetelekor mindkettot
 * boviteni kellett volna.
 *
 * === A FELTETEL AZ ALAK, NEM A NEV, ES EZ MERT KULONBSEG ===
 *
 * Elsore a `...Document` vegu MODELLNEVEKRE kerestem. A mero azonnal pirosra
 * valtott egy NEGYEDIK modellen (`AiProductSearchDocument`), ami nem
 * csatolmany-tabla, hanem kereso-index: nincs se `sizeBytes`, se `storageKey`
 * mezoje. A nev-alapu kerdes tehat egy olyan tablat kert szamon, aminek nincs
 * mit szamolni.
 *
 * Ezert a feltetel most az ALAK: az a tabla szamit, amelyiken `sizeBytes` ES
 * `storageKey` is all -- vagyis ami TENYLEG bajtokat tart a koteten, es meg is
 * mondja, mennyit.
 *
 * === AMI EBBOL KIESIK, ES MIERT NEM DONTES ===
 *
 * A `ProductImage` UGYANARRA a kotetre ir (`storageKey`, `products/` gyoker), es
 * nincs az osszegben. Merve 2026-09-14: azert nincs, mert NEM LEHET --
 * `sizeBytes` mezoje nincs, tehat a meretet a tabla nem is orzi. Ez KORLAT, nem
 * dontes, es a feloldasa egy uj oszlop lenne, nem egy sor ebben az osszegben.
 * Kimondva, mert egy hallgatas itt ugy nezne ki, mint lefedettseg.
 */

const SEMA = "../../packages/database/prisma/schema.prisma";
const OSSZEG = "src/documents/document-bytes-in-use.ts";

/** Az a tabla, ami bajtokat tart a koteten, ES meg is mondja, mennyit. */
function kotetetFoglaloTablak(): string[] {
  const sema = readFileSync(SEMA, "utf8");
  const nevek: string[] = [];
  for (const modell of sema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const torzs = modell[2] ?? "";
    if (
      /^\s*sizeBytes\s+Int/m.test(torzs) &&
      /^\s*storageKey\s+String/m.test(torzs)
    )
      nevek.push(modell[1]!);
  }
  return nevek;
}

describe("a keret minden kötetet foglaló táblát számol", () => {
  /**
   * A KONTROLL A KERESESRE, es ez az allitas tartja a masikat.
   *
   * Egy mintaillesztes, ami URES halmazt vet ossze egy szaballyal, ZOLDEN
   * HAZUDIK: nem talal kimaradt tablat, mert nem talal tablat. Ha a sema utja
   * elcsuszik vagy a modellek alakja valtozik, ez a sor szol eloszor.
   */
  it("megtalálja a táblákat, amiket vizsgálni akar", () => {
    const tablak = kotetetFoglaloTablak();
    assert.deepEqual(
      tablak.slice().sort(),
      [
        "AssetDocument",
        "CompletionCertificateDocument",
        "ContractDocument",
        "MaintenanceOrderDocument",
        "ServiceJobDocument",
        "WorksheetDocument",
      ],
      `A sémából ez jött: ${tablak.join(", ")}. Ha ÚJ tábla jelent meg, vedd fel az összegbe is; ha eltűnt valamelyik, a minta vagy az útvonal elavult.`,
    );
  });

  it("mindegyik szerepel a keret összegében", () => {
    const osszeg = readFileSync(OSSZEG, "utf8");
    const kimaradt = kotetetFoglaloTablak().filter((tabla) => {
      // A Prisma kliensen a modell neve kisbetus kezdobetuvel all.
      const hivas = tabla.charAt(0).toLowerCase() + tabla.slice(1);
      return !osszeg.includes(`prisma.${hivas}.aggregate(`);
    });
    assert.deepEqual(
      kimaradt,
      [],
      `Ezek a táblák nincsenek benne a keret összegében: ${kimaradt.join(", ")}. Amíg kimaradnak, a keret egy RÉSZHALMAZON mér, és a határt CSENDBEN lépjük át.`,
    );
  });
});
