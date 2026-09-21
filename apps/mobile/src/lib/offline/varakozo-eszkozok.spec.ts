import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  eszkozokVarakozokkal,
  varakozoEszkozok,
  type SorbanAlloSor,
} from "./varakozo-eszkozok";

const sor = (reszlet: Partial<SorbanAlloSor> = {}): SorbanAlloSor => ({
  id: "op-1",
  operation: "create",
  entityType: "asset",
  payloadJson: JSON.stringify({ name: "Fő szivattyú", labelCode: "A1B2C" }),
  ...reszlet,
});

describe("a fel nem ment eszközök a listán", () => {
  it("az eszköz-felvitel megjelenik, névvel és matricakóddal", () => {
    const eredmeny = varakozoEszkozok([sor()]);
    assert.deepEqual(eredmeny, [
      { operationId: "op-1", name: "Fő szivattyú", labelCode: "A1B2C" },
    ]);
  });

  /**
   * A MODOSITAS ES A FENYKEP NEM KERUL A LISTARA: azok MAR LETEZO rekordhoz
   * tartoznak, tehat az eszkoz amugy is ott all. Egy fel nem ment modositas
   * MASODIK sorkent jelenne meg ugyanarrol az eszkozrol.
   *
   * MI PIROSIT: egy szuro, ami csak az `entityType`-ot nezi. A `update` sor
   * ugyanugy `asset` tipusu.
   */
  it("a módosítás és a fénykép NEM jelenik meg felvitelként", () => {
    const eredmeny = varakozoEszkozok([
      sor({ id: "op-2", operation: "update" }),
      sor({ id: "op-3", operation: "upload-photo" }),
      sor({ id: "op-4", entityType: "worksheet" }),
    ]);
    assert.deepEqual(eredmeny, []);
  });

  /**
   * A SERULT TORZS NEM VISZI EL AZ EGESZ LISTAT. Egy kivetel itt azt
   * jelentene, hogy egy olvashatatlan sor miatt a szerelo a sajat, EP
   * felviteleit sem latja.
   *
   * MI PIROSIT: egy csupasz `JSON.parse` orzo nelkul.
   */
  it("a sérült törzs sem dob, és a sor nem tűnik el", () => {
    const eredmeny = varakozoEszkozok([
      sor({ id: "op-5", payloadJson: "{ez nem json" }),
      sor({ id: "op-6" }),
    ]);
    assert.equal(eredmeny.length, 2);
    assert.equal(eredmeny[0]?.name, "Névtelen felvitel");
    assert.equal(eredmeny[0]?.labelCode, null);
    assert.equal(eredmeny[1]?.name, "Fő szivattyú");
  });

  /**
   * A HIANYZO NEV KIMONDVA ALL. Egy ures sor a listan ugy nezne ki, mint egy
   * elromlott sor -- es a szerelo epp azt keresne, hogy megvan-e a felvitele.
   */
  it("a névtelen felvitel kimondva jelenik meg", () => {
    const eredmeny = varakozoEszkozok([
      sor({ payloadJson: JSON.stringify({ name: "   " }) }),
    ]);
    assert.equal(eredmeny[0]?.name, "Névtelen felvitel");
  });

  /**
   * A VARAKOZOK A LISTA ELEJERE KERULNEK, mert a szerelo epp az imenti
   * felvitelet keresi.
   *
   * MI PIROSIT: a sorrend megfordítása. A `fajta` mezo kulon allitas: ebbol
   * tudja a kepernyo, melyik sort kell megjelolnie.
   */
  it("a várakozók a lista elején állnak, megjelölve", () => {
    const eredmeny = eszkozokVarakozokkal({
      szerverElemek: [{ id: "a1" }],
      varakozok: [{ operationId: "op-1", name: "Új", labelCode: null }],
    });
    assert.equal(eredmeny[0]?.fajta, "varakozo");
    assert.equal(eredmeny[1]?.fajta, "kesz");
    assert.equal(eredmeny.length, 2);
  });

  /**
   * POZITIV KONTROLL: varakozo nelkul a lista VALTOZATLAN marad. Enelkul a
   * fenti allitas egy olyan valtozatot is zolden hagyna, ami mindig betesz egy
   * ures sort a lista elejere.
   */
  it("POZITÍV KONTROLL: várakozó nélkül a lista változatlan", () => {
    const eredmeny = eszkozokVarakozokkal({
      szerverElemek: [{ id: "a1" }, { id: "a2" }],
      varakozok: [],
    });
    assert.equal(eredmeny.length, 2);
    assert.ok(eredmeny.every((sor) => sor.fajta === "kesz"));
  });
});
