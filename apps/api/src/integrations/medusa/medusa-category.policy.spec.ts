import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  decideMedusaCategories,
  describeMissingCategoryMapping,
  MEDUSA_CATEGORY_REFERENCE,
} from "./medusa-category.policy.js";

describe("a kategóriák leképezése a vetítésben", () => {
  it("teljes leképezésnél a Medusa-azonosítókat adja, a bemenet sorrendjében", () => {
    const decision = decideMedusaCategories(
      ["cat_korall", "cat_hal"],
      [
        { entityId: "cat_hal", externalId: "pcat_hal" },
        { entityId: "cat_korall", externalId: "pcat_korall" },
      ],
    );

    assert.equal(decision.kind, "complete");
    // A lekérdezés visszatérési sorrendje NEM garantált: a kimenet a bemenetet
    // követi, különben két futás két különböző kérés-törzset adna.
    assert.deepEqual(decision.medusaCategoryIds, ["pcat_korall", "pcat_hal"]);
    assert.deepEqual(decision.missing, []);
  });

  it("kategória nélküli terméknél nincs mit küldeni", () => {
    const decision = decideMedusaCategories([], []);

    assert.equal(decision.kind, "none");
    assert.equal(decision.medusaCategoryIds, null);
    assert.deepEqual(decision.missing, []);
  });

  /**
   * MINDEN VAGY SEMMI. Egyetlen hiányzó leképezés az EGÉSZ mezőt visszatartja:
   * a részleges lista -- ha a mező csere-szemantikájú -- letörölné a termékről
   * azokat a kategóriákat, amiket nem tudtunk megnevezni.
   */
  it("egyetlen hiányzó leképezés az egész mezőt visszatartja", () => {
    const decision = decideMedusaCategories(
      ["cat_korall", "cat_hal"],
      [{ entityId: "cat_korall", externalId: "pcat_korall" }],
    );

    assert.equal(decision.kind, "incomplete");
    assert.equal(decision.medusaCategoryIds, null);
    assert.deepEqual(decision.missing, ["cat_hal"]);
  });

  /**
   * EZ AZ AZ ÁLLÍTÁS, AMIÉRT A DÖNTÉS UNIÓ ÉS NEM EGY MEZŐ.
   *
   * A "nincs kategóriája" és a "van, de még nincs leképezve" a kérés törzsére
   * nézve UGYANAZ: egyik sem küld `categories` kulcsot. A következményük
   * viszont ellentétes -- az első rendben van, a második hiányt jelez --, és ha
   * a két állapot ugyanúgy nézne ki, később senki nem tudná megmondani,
   * melyik állt fenn.
   */
  it("a két üres eset a törzsre nézve azonos, a jelentésre nézve NEM", () => {
    const nincs = decideMedusaCategories([], []);
    const nincsLekepezve = decideMedusaCategories(["cat_hal"], []);

    // A törzs szempontjából megkülönböztethetetlen: ez a szándék.
    assert.equal(nincs.medusaCategoryIds, null);
    assert.equal(nincsLekepezve.medusaCategoryIds, null);

    // A jelentés szempontjából viszont NEM az.
    assert.notEqual(nincs.kind, nincsLekepezve.kind);
    assert.deepEqual(nincs.missing, []);
    assert.deepEqual(nincsLekepezve.missing, ["cat_hal"]);
  });

  /**
   * A HIÁNYT HALMAZ-LEFEDÉS DÖNTI EL, NEM A KÉT LISTA HOSSZA.
   *
   * Ez a bemenet pontosan azon a különbségen áll: két kategória, két
   * leképezés-sor -- de az egyik sor DUPLIKÁTUM, tehát az egyik kategória
   * lefedetlen. Hossz-összevetéssel ez "teljes" lenne, és részleges listát
   * küldenénk ki: pont azt a csendes törlést, amit ez a modul megelőz.
   *
   * A séma ma mindkét oldalon kizárja a duplikációt
   * (`ProductCategory @@unique([productId, categoryId])`,
   * `ExternalReference @@unique([system, entityType, entityId])`), tehát ez a
   * bemenet MA nem áll elő. Az állítás nem is a mai adatot méri, hanem azt,
   * hogy egy megszorítás elvesztése ne NÉMA hibává váljon.
   */
  it("duplikált leképezés-sor nem tesz teljessé egy hiányos lefedést", () => {
    const decision = decideMedusaCategories(
      ["cat_korall", "cat_hal"],
      [
        { entityId: "cat_korall", externalId: "pcat_korall" },
        { entityId: "cat_korall", externalId: "pcat_korall" },
      ],
    );

    assert.equal(decision.kind, "incomplete");
    assert.deepEqual(decision.missing, ["cat_hal"]);
  });

  it("ismétlődő bemeneti azonosító nem jelent hiányt", () => {
    const decision = decideMedusaCategories(
      ["cat_hal", "cat_hal"],
      [{ entityId: "cat_hal", externalId: "pcat_hal" }],
    );

    assert.equal(decision.kind, "complete");
    assert.deepEqual(decision.medusaCategoryIds, ["pcat_hal"]);
  });

  /**
   * A SOR AZ AZONOSÍTÓKAT NEVEZI MEG, nem csak a darabszámot: a leképezés
   * pótlása pontosan azokon múlik.
   */
  it("a hiány sora megnevezi, MELYIK kategória hiányzik", () => {
    const sor = describeMissingCategoryMapping("prod_1", [
      "cat_hal",
      "cat_rak",
    ]);

    assert.match(sor, /prod_1/);
    assert.match(sor, /2 kategória/);
    assert.match(sor, /cat_hal, cat_rak/);
    assert.match(sor, /EGYIKET SEM/);
  });
});

/**
 * SZERKEZETI ALLITAS: a lekepezes-sor keresesi kulcsa EGY helyen all.
 *
 * Nem a viselkedest meri, hanem a LEFEDETTSEGET -- ugyanaz az alak, mint a
 * titok-olvasas specje. Az ok a `system` es az `entityType` KULONBSEGE: a
 * `system` a sema ENUMJA, tehat egy elgepeles forditasi hiba. Az `entityType`
 * szabad `String`, tehat NEM az.
 *
 * A tabla ket vegen ket iró all: a betoltes IR ide, a vetites innen OLVAS. Ha a
 * ket oldal ket irasmodot hasznalna, semmi nem szolna -- a vetites minden
 * termeknel "meg nincs lekepezve" allapotot latna, es kategoria nelkul
 * vetitene. A repoban mindket irasmod letezik (`"Category"` es `"CATEGORY"`),
 * csak ket kulonbozo tablanal, es ugyanabban a modulban egymas mellett.
 *
 * A lista GEPI, nem kezzel karbantartott: pontosan egy holnap szuletett uj
 * fajl ellen ved, ami sajat literalt irna.
 */
const CATEGORY_ENTITY_TYPE_LITERAL = /entityType:\s*["'`]Category["'`]/;
const POLICY_FILE = "src/integrations/medusa/medusa-category.policy.ts";
const PROJECTION_CLI = "src/integrations/medusa/medusa-projection.cli.ts";

async function medusaSources(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("src/integrations/medusa/**/*.ts"))
    if (!entry.endsWith(".spec.ts")) found.push(entry.replaceAll("\\", "/"));
  return found.sort();
}

describe("a leképezés-sor keresési kulcsa", () => {
  /**
   * A KONTROLL A KERESESRE. Enelkul egy elrontott minta nulla talalatot adna, es
   * a teszt zolden azt allitana, hogy sehol nincs sajat literal -- holott azt
   * jelentene, hogy a kereses romlott el.
   */
  it("finds the literal in a sample that has it", () => {
    assert.equal(
      CATEGORY_ENTITY_TYPE_LITERAL.test('entityType: "Category",'),
      true,
    );
    // Es a NAGYBETUS alak NEM ugyanaz: a ket irasmod kulonbsege a tet.
    assert.equal(
      CATEGORY_ENTITY_TYPE_LITERAL.test('entityType: "CATEGORY",'),
      false,
    );
  });

  it("reads the files it claims to read", async () => {
    const sources = await medusaSources();

    assert.ok(
      sources.length >= 10,
      `Csak ${sources.length} forrásfájlt találtam. Ez a keresés hibája, nem a lefedettségé.`,
    );
    // A ket erintett fajlnak NEV SZERINT benne kell lennie, kulonben a nulla
    // talalat azt jelentene, hogy nem is neztuk meg.
    assert.equal(sources.includes(POLICY_FILE), true);
    assert.equal(sources.includes(PROJECTION_CLI), true);
  });

  it("keeps the literal in one file, and everyone else calls the constant", async () => {
    const sources = await medusaSources();

    const sajatLiteral = sources.filter((file) =>
      CATEGORY_ENTITY_TYPE_LITERAL.test(readFileSync(file, "utf8")),
    );

    assert.deepEqual(
      sajatLiteral,
      [POLICY_FILE],
      `Ezek a fájlok saját literált tartanak a közös kulcs helyett: ${sajatLiteral.join(", ")}`,
    );
  });

  /**
   * ES AZ ERTEK MAGA. Ez elsore tautologianak latszik -- a konstanst meri a
   * konstans ellen --, de nem az: azt ROGZITI, MELYIK irasmodot valasztottuk.
   * Ha valaki atirja, ez pirosra valt, es akkor fel lehet tenni a kerdest, ami
   * kulonben senkinek nem jutna eszebe: a tabla MASIK vege is atallt?
   */
  it("names the spelling both ends must share", () => {
    assert.equal(MEDUSA_CATEGORY_REFERENCE.system, "MEDUSA");
    assert.equal(MEDUSA_CATEGORY_REFERENCE.entityType, "Category");
  });
});
